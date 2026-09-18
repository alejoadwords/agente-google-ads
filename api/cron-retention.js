// api/cron-retention.js — mantenimiento diario de la base de contactos.
//
// Dos trabajos, en este orden:
//   1. Reglas de retención de cada cuenta: mandar a la papelera lo que ya
//      cumplió el plazo (perdidos viejos, leads sin actividad).
//   2. Purga definitiva de la papelera pasados los días de gracia.
//
// La purga es el único borrado irreversible del sistema, por eso solo toca
// filas que llevan más de RETENCION_GRACIA días con deleted_at.

import { registrarError } from './_registro-errores.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RETENCION_KEY = '__retention_rules__';
const GRACIA_DIAS = 30;

// Los `limit=2000` de antes devolvían 1.000: PostgREST corta ahí y no lo dice.
// Pero el problema gordo era otro: con mil ids, `id=in.(...)` arma una URL de
// 37 KB y el servidor la rechaza. O sea que el día que una cuenta tuviera mil
// leads que archivar, la petición fallaba entera — y el fallo se tragaba un
// `.catch(() => {})`. Nadie se habría enterado nunca.
const LOTE_IDS = 100;        // 100 uuid son ~3,7 KB de URL: cabe de sobra
const TOPE_POSTGREST = 1000; // lo que devuelve el servidor por página
const MAX_POR_CORRIDA = 20000;

const trozos = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

// Un fallo aquí borra o deja de borrar datos de un cliente. No puede quedarse
// en un console.error que no lee nadie.
// `origen` solo admite 'api' | 'cron' | 'navegador' — es lo que agrupa el panel
// de errores. El nombre del cron va en `donde`, que es texto libre.
async function avisar(donde, error, detalle) {
  await registrarError({ origen: 'cron', donde: `cron-retention/${donde}`, error, detalle }).catch(() => {});
}

function sb() {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  };
}

function haceDias(n) {
  return new Date(Date.now() - n * 86400000).toISOString();
}

// Reglas por cuenta: { perdidos_dias: 180, sin_actividad_dias: 365 }
// 0 o ausente = desactivada. Se guardan como el resto de config sin esquema.
async function reglasDeRetencion() {
  const rows = await fetch(
    `${SUPABASE_URL}/rest/v1/user_profiles?agent_key=eq.${RETENCION_KEY}&select=user_id,profile_data`,
    { headers: sb() }
  ).then(r => (r.ok ? r.json() : [])).catch(() => []);
  return rows || [];
}

async function aPapelera(userId, filtro, donde) {
  const q = `${SUPABASE_URL}/rest/v1/leads?user_id=eq.${encodeURIComponent(userId)}` +
            `&deleted_at=is.null&stage=neq.ganado${filtro}&select=id&limit=${TOPE_POSTGREST}`;
  let movidos = 0;
  // Siempre se lee desde el principio: al marcar `deleted_at` esas filas dejan
  // de cumplir el filtro, así que la siguiente vuelta trae las siguientes. Con
  // `offset` se habrían saltado justo tantas como se acababan de archivar.
  while (movidos < MAX_POR_CORRIDA) {
    const res = await fetch(q, { headers: sb() });
    if (!res.ok) { await avisar(donde, new Error(`leer: ${res.status} ${(await res.text()).slice(0, 150)}`)); break; }
    const ids = ((await res.json()) || []).map(r => r.id);
    if (!ids.length) break;
    let fallo = false;
    for (const tanda of trozos(ids, LOTE_IDS)) {
      const p = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=in.(${tanda.join(',')})`, {
        method: 'PATCH', headers: sb(),
        body: JSON.stringify({ deleted_at: new Date().toISOString() }),
      });
      if (!p.ok) {
        await avisar(donde, new Error(`archivar: ${p.status} ${(await p.text()).slice(0, 150)}`), `cuenta ${userId}`);
        fallo = true; break;
      }
      movidos += tanda.length;
    }
    // Si la escritura falla, volver a leer devolvería lo mismo para siempre.
    if (fallo || ids.length < TOPE_POSTGREST) break;
  }
  return movidos;
}

export default async function handler(req, res) {
  // Vercel firma sus crons; en manual exigimos el secreto
  const auth = req.headers?.authorization || '';
  const secreto = req.headers?.['x-acuarius-secret'];
  const esCron = auth === `Bearer ${process.env.CRON_SECRET}`;
  if (!esCron && secreto !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const resumen = { cuentas: 0, a_papelera: 0, purgados: 0, errores: [] };

  // 1 — reglas de retención por cuenta
  for (const fila of await reglasDeRetencion()) {
    const r = fila.profile_data || {};
    let movidos = 0;
    try {
      if (Number(r.perdidos_dias) > 0) {
        movidos += await aPapelera(fila.user_id,
          `&stage=eq.perdido&updated_at=lt.${encodeURIComponent(haceDias(Number(r.perdidos_dias)))}`,
          'papelera/perdidos');
      }
      if (Number(r.sin_actividad_dias) > 0) {
        movidos += await aPapelera(fila.user_id,
          `&updated_at=lt.${encodeURIComponent(haceDias(Number(r.sin_actividad_dias)))}`,
          'papelera/sin-actividad');
      }
      resumen.cuentas++;
      resumen.a_papelera += movidos;
    } catch (e) {
      resumen.errores.push(`${fila.user_id}: ${e.message}`);
    }
  }

  // 2 — purga definitiva de la papelera vencida
  //
  // Se hace por tandas pequeñas y se comprueba CADA paso. Antes las bajas de
  // las tablas dependientes llevaban `.catch(() => {})`: si una fallaba, el
  // borrado del lead chocaba después contra la clave foránea y el único rastro
  // era una línea en `resumen.errores` que no lee nadie. Peor todavía: podían
  // borrarse las actividades de un lead que al final no se borraba.
  const vencidos = `${SUPABASE_URL}/rest/v1/leads?deleted_at=lt.${encodeURIComponent(haceDias(GRACIA_DIAS))}` +
                   `&select=id&limit=${TOPE_POSTGREST}`;
  const COLGANDO   = ['lead_activities', 'activities', 'nps_responses', 'campaign_recipients', 'email_events'];
  const CON_VIDA   = ['proposals', 'chat_conversations'];

  try {
    while (resumen.purgados < MAX_POR_CORRIDA) {
      const lectura = await fetch(vencidos, { headers: sb() });
      if (!lectura.ok) { await avisar('purga/leer', new Error(`${lectura.status} ${(await lectura.text()).slice(0, 150)}`)); break; }
      const ids = ((await lectura.json()) || []).map(x => x.id);
      if (!ids.length) break;

      let corta = false;
      for (const tanda of trozos(ids, LOTE_IDS)) {
        const lista = tanda.join(',');
        let paso = null;
        // Lo que solo existe por el lead se va con él…
        for (const tabla of COLGANDO) {
          const r = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?lead_id=in.(${lista})`, { method: 'DELETE', headers: sb() });
          if (!r.ok) { paso = `${tabla}: ${r.status} ${(await r.text()).slice(0, 120)}`; break; }
        }
        // …y lo que vale por sí mismo (una propuesta firmada, el hilo del
        // inbox) solo pierde el vínculo.
        if (!paso) for (const tabla of CON_VIDA) {
          const r = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?lead_id=in.(${lista})`, {
            method: 'PATCH', headers: sb(), body: JSON.stringify({ lead_id: null }),
          });
          if (!r.ok) { paso = `${tabla}: ${r.status} ${(await r.text()).slice(0, 120)}`; break; }
        }
        if (paso) {
          // Se para antes de tocar el lead: dejarlo a medias sería destruir su
          // historial y conservar el contacto, lo peor de las dos opciones.
          await avisar('purga/dependientes', new Error(paso), `${tanda.length} contactos sin purgar`);
          corta = true; break;
        }
        const del = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=in.(${lista})`, { method: 'DELETE', headers: sb() });
        if (!del.ok) {
          await avisar('purga/leads', new Error(`${del.status} ${(await del.text()).slice(0, 150)}`));
          corta = true; break;
        }
        resumen.purgados += tanda.length;
      }
      if (corta || ids.length < TOPE_POSTGREST) break;
    }
  } catch (e) {
    await avisar('purga', e);
    resumen.errores.push(`purga: ${e.message}`);
  }

  console.log('[cron-retention]', JSON.stringify(resumen));
  return res.status(200).json(resumen);
}

// api/cron-retention.js — mantenimiento diario de la base de contactos.
//
// Dos trabajos, en este orden:
//   1. Reglas de retención de cada cuenta: mandar a la papelera lo que ya
//      cumplió el plazo (perdidos viejos, leads sin actividad).
//   2. Purga definitiva de la papelera pasados los días de gracia.
//
// La purga es el único borrado irreversible del sistema, por eso solo toca
// filas que llevan más de RETENCION_GRACIA días con deleted_at.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RETENCION_KEY = '__retention_rules__';
const GRACIA_DIAS = 30;

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

async function aPapelera(userId, filtro) {
  const q = `${SUPABASE_URL}/rest/v1/leads?user_id=eq.${encodeURIComponent(userId)}&deleted_at=is.null&stage=neq.ganado${filtro}&select=id&limit=2000`;
  const rows = await fetch(q, { headers: sb() }).then(r => (r.ok ? r.json() : [])).catch(() => []);
  const ids = (rows || []).map(r => r.id);
  if (!ids.length) return 0;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=in.(${ids.join(',')})`, {
    method: 'PATCH',
    headers: sb(),
    body: JSON.stringify({ deleted_at: new Date().toISOString() }),
  });
  return res.ok ? ids.length : 0;
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
          `&stage=eq.perdido&updated_at=lt.${encodeURIComponent(haceDias(Number(r.perdidos_dias)))}`);
      }
      if (Number(r.sin_actividad_dias) > 0) {
        movidos += await aPapelera(fila.user_id,
          `&updated_at=lt.${encodeURIComponent(haceDias(Number(r.sin_actividad_dias)))}`);
      }
      resumen.cuentas++;
      resumen.a_papelera += movidos;
    } catch (e) {
      resumen.errores.push(`${fila.user_id}: ${e.message}`);
    }
  }

  // 2 — purga definitiva de la papelera vencida
  try {
    const viejos = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?deleted_at=lt.${encodeURIComponent(haceDias(GRACIA_DIAS))}&select=id&limit=2000`,
      { headers: sb() }
    ).then(r => (r.ok ? r.json() : [])).catch(() => []);
    const ids = (viejos || []).map(x => x.id);
    if (ids.length) {
      // Primero lo que cuelga del lead, o el DELETE choca contra las FK.
      // Lo que solo existe por el lead se va con él…
      for (const tabla of ['lead_activities', 'activities', 'nps_responses', 'campaign_recipients', 'email_events']) {
        await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?lead_id=in.(${ids.join(',')})`, {
          method: 'DELETE', headers: sb(),
        }).catch(() => {});
      }
      // …y lo que vale por sí mismo (una propuesta firmada, el hilo del inbox)
      // solo pierde el vínculo.
      for (const tabla of ['proposals', 'chat_conversations']) {
        await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?lead_id=in.(${ids.join(',')})`, {
          method: 'PATCH', headers: sb(), body: JSON.stringify({ lead_id: null }),
        }).catch(() => {});
      }
      const del = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=in.(${ids.join(',')})`, {
        method: 'DELETE', headers: sb(),
      });
      if (del.ok) resumen.purgados = ids.length;
      else resumen.errores.push(`purga: ${await del.text()}`);
    }
  } catch (e) {
    resumen.errores.push(`purga: ${e.message}`);
  }

  return res.status(200).json(resumen);
}

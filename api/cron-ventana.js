// api/cron-ventana.js
// Avisa antes de que se cierre la ventana de 24 horas de WhatsApp.
//
// Es el punto donde de verdad se pierde dinero: pasadas 24 horas desde el
// último mensaje del cliente ya no se le puede escribir libremente. Una
// conversación que caduca de madrugada se pierde sin que nadie la mire, y en el
// inbox solo se nota si alguien entra a mirarla.
//
// Corre cada hora (vercel.json).
export const config = { runtime: 'edge' };

import { getRegla, crearTareaVentana } from './_followup.js';
import { pedirLista } from './_pedir.js';
import { latir } from './_latido.js';
import { cerrarSoportesVencidos } from './_soporte-sesion.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET  = process.env.CRON_SECRET;
// Páginas y tope de tiempo (la función edge tiene 25 s). Antes se tomaban las
// 120 más antiguas y las de cuentas con el aviso apagado se saltaban SIN
// marcar: con más de 120 de esas, las de cuentas con el aviso encendido no se
// miraban nunca y la ventana se les cerraba sin aviso (30-09-2026).
export const PAGINA = 200;
export const TOPE_MS = 18 * 1000;
// Un lead cerrado ya no necesita rescate. La etapa vive en `stage` (y el
// cierre sella closed_at): el cron pedía `status`, una columna que no existe,
// PostgREST devolvía error, el lead se daba por inexistente y la conversación
// se marcaba como avisada SIN crear la tarea. Desde el 14-08-2026 el aviso de
// ventana no creó ni una.
const CERRADAS = ['ganado', 'perdido', 'won', 'lost', 'cerrado', 'descartado'];
export function leadCerrado(lead) {
  return !!lead?.closed_at || CERRADAS.includes(String(lead?.stage || '').toLowerCase());
}

function sb() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'return=representation',
  };
}

export default async function handler(req) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
  }

  // La entrada, aparte de la salida: un latido que solo se escribe al terminar
  // no distingue «Vercel no lo llamó» de «lo llamó y se murió a mitad».
  await latir('cron-ventana', { empezo: new Date().toISOString() });

  // De paso, cada hora: las entradas del equipo a cuentas de clientes que
  // pasaron su hora se cierran en Clerk (ver api/_soporte-sesion.js). Va
  // primero y aparte: un fallo de las ventanas no puede dejar abierta la
  // cuenta de un cliente, ni al revés.
  let soportes;
  try { soportes = await cerrarSoportesVencidos(); }
  catch (e) { soportes = { error: e?.message || String(e) }; }


  const ahora = Date.now();
  // La franja: lo que ya entró en las últimas horas de vida de la ventana pero
  // todavía no ha caducado. El aviso se marca en la fila, así que aunque una
  // pasada se salte no se avisa dos veces ni se pierde.
  const desde = new Date(ahora - 24 * 3600000).toISOString();   // aún viva
  const hasta = new Date(ahora - 12 * 3600000).toISOString();   // franja más ancha que el máximo configurable

  // «La base no contestó» no es «no hay ventanas por cerrarse»: confundirlo
  // deja a un cliente sin el aviso y la ventana de 24 h se le cierra sin que
  // nadie lo supiera. Ver api/_pedir.js.
  const tope = ahora + (Number(process.env.VENTANA_TOPE_MS) || TOPE_MS);   // la variable solo existe en la prueba
  const marcar = (id) => fetch(`${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${id}`, {
    method: 'PATCH', headers: sb(), body: JSON.stringify({ aviso_ventana_at: new Date().toISOString() }),
  });

  // La regla es por cuenta: se pide una vez por cuenta, no una por conversación.
  const reglas = new Map();
  let avisadas = 0, saltadas = 0, revisadas = 0, errores = 0, sinTiempo = false;

  for (let pagina = 0; ; pagina += PAGINA) {
    if (Date.now() >= tope) { sinTiempo = true; break; }
    // «La base no contestó» no es «no hay ventanas por cerrarse»: confundirlo
    // deja a un cliente sin el aviso y la ventana de 24 h se le cierra sin que
    // nadie lo supiera. Ver api/_pedir.js.
    let convs;
    try {
      convs = await pedirLista(
        `${SUPABASE_URL}/rest/v1/chat_conversations?channel=eq.whatsapp&status=neq.resolved` +
        `&aviso_ventana_at=is.null&lead_id=not.is.null` +
        `&last_inbound_at=gt.${encodeURIComponent(desde)}&last_inbound_at=lt.${encodeURIComponent(hasta)}` +
        `&select=id,user_id,lead_id,contact_name,last_inbound_at&order=last_inbound_at.asc,id.asc&limit=${PAGINA}&offset=${pagina}`,
        sb(), 'las conversaciones con la ventana por cerrarse'
      );
    } catch (e) {
      await latir('cron-ventana', { error: true }, e?.message || String(e));
      return new Response(JSON.stringify({ error: e?.message || 'no se pudo leer las conversaciones' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }

    for (const c of convs) {
      if (Date.now() >= tope) { sinTiempo = true; break; }
      revisadas++;
      try {
        if (!reglas.has(c.user_id)) reglas.set(c.user_id, await getRegla(c.user_id));
        const regla = reglas.get(c.user_id);
        if (!regla.ventana_24h) { saltadas++; continue; }

        const quedanMs = new Date(c.last_inbound_at).getTime() + 24 * 3600000 - ahora;
        const quedanH = quedanMs / 3600000;
        // Todavía no toca: se deja para una pasada posterior, sin marcar nada.
        if (quedanH > regla.ventana_horas_antes) continue;
        // Ya caducó entre la consulta y aquí: avisar ahora no sirve de nada.
        if (quedanH <= 0) { await marcar(c.id).catch(() => {}); saltadas++; continue; }

        const rl = await fetch(
          `${SUPABASE_URL}/rest/v1/leads?id=eq.${c.lead_id}&select=id,name,phone,client_id,stage,closed_at`,
          { headers: sb() }
        );
        // Si no se pudo leer el lead NO se marca: se reintenta en la próxima
        // pasada. Un fallo nunca puede pasar por «ya avisado».
        if (!rl.ok) throw new Error('no se pudo leer el lead (Supabase ' + rl.status + ')');
        const lead = (await rl.json())?.[0] || null;

        // Borrado, o ganado/perdido: ya no necesita rescate.
        if (!lead || leadCerrado(lead)) { await marcar(c.id).catch(() => {}); saltadas++; continue; }

        // Lanza si no pudo crearla: entonces no se marca, y se reintenta.
        await crearTareaVentana(c.user_id, lead, c, Math.max(1, Math.round(quedanH)));
        await marcar(c.id).catch(() => {});
        avisadas++;
      } catch (e) {
        errores++;
        console.error('cron-ventana', c.id, e?.message);
      }
    }
    if (sinTiempo || convs.length < PAGINA) break;
  }

  const fallo = [errores ? errores + ' aviso(s) no se pudieron crear' : '', sinTiempo ? 'no alcanzó el tiempo' : ''].filter(Boolean).join(' · ');
  const falloSoporte = soportes?.error ? 'entradas de soporte: ' + soportes.error
    : soportes?.fallidas ? soportes.fallidas + ' sesiones de soporte vencidas que Clerk no cerró' : null;
  await latir('cron-ventana', { avisadas, saltadas, revisadas, errores, sinTiempo, soportes }, [fallo, falloSoporte].filter(Boolean).join(' · ') || null);
  return new Response(JSON.stringify({ ok: true, avisadas, saltadas, revisadas, errores, sinTiempo, soportes }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

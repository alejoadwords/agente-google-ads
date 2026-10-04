// api/cron-alertas-pauta.js — cada mañana, lo que cambió ayer en la pauta
//
// Corre a las 8:00 de Colombia. Revisa cada cuenta (y cada cliente de una
// agencia) que tenga Google Ads o Meta conectado con cuenta elegida, compara
// ayer con la semana anterior y manda UN correo con lo que haya, solo si hay
// algo. Ver api/_alertas-pauta.js.
export const config = { runtime: 'edge' };

import { alertasDeCuenta, registrarNuevas, mandarResumen } from './_alertas-pauta.js';
import { evaluarCuenta } from './_reglas-pauta.js';
import { latir } from './_latido.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TOPE_MS = 20000;

export default async function handler(req) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
  }
  await latir('cron-alertas-pauta', { empezo: new Date().toISOString() });
  const fin = Date.now() + TOPE_MS;
  const res = { cuentas: 0, alertas: 0, acciones: 0, correos: 0, errores: 0, erroresReglas: 0, sinTiempo: 0 };
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/platform_connections?platform=in.(google_ads,meta_ads)&account_id=not.is.null&select=user_id,client_id`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    if (!r.ok) throw new Error('Supabase ' + r.status + ' al listar las conexiones');
    // Una pasada por cuenta: las conexiones de sus clientes van juntas, y el
    // dueño recibe un solo correo con todo.
    const cuentas = [...new Set((await r.json()).map(f => f.user_id))];
    for (const userId of cuentas) {
      if (Date.now() > fin) { res.sinTiempo++; continue; }
      try {
        const { alertas } = await alertasDeCuenta(userId, null);
        const nuevas = await registrarNuevas(userId, null, alertas);
        // Las reglas van aparte: si fallan, las alertas salen igual, y se
        // cuenta en el latido para que no se pierda en silencio.
        let acciones = [];
        try { acciones = await evaluarCuenta(userId); }
        catch (e) { res.erroresReglas++; console.error('[reglas-pauta]', userId, e?.message || e); }
        res.cuentas++; res.alertas += nuevas.length; res.acciones += acciones.length;
        if (nuevas.length || acciones.length) {
          const m = await mandarResumen(userId, nuevas, acciones);
          if (m.enviado) res.correos++;
          else console.warn('[alertas-pauta] correo no enviado', userId, m.motivo);
        }
      } catch (e) {
        res.errores++;
        console.error('[alertas-pauta]', userId, e?.message || e);
      }
    }
    await latir('cron-alertas-pauta', res, res.errores ? res.errores + ' cuentas no se pudieron revisar' : res.erroresReglas ? res.erroresReglas + ' cuentas sin evaluar sus reglas' : (res.sinTiempo ? res.sinTiempo + ' cuentas sin tiempo' : null));
    return new Response(JSON.stringify({ ok: true, ...res }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    await latir('cron-alertas-pauta', { error: true }, e?.message || String(e));
    return new Response(JSON.stringify({ error: e?.message || 'falló' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

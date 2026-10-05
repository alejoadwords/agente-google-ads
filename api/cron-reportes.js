// api/cron-reportes.js — envía los reportes programados que tocan hoy
//
// Corre cada 15 minutos entre las 7:00 y las 9:45 de Colombia. Cada corrida
// toma los reportes con próximo envío vencido y los manda hasta agotar su
// tiempo; lo que no alcance, lo toma la siguiente. Un lunes con muchas agencias
// no cabe en una sola corrida: cada reporte lee Google, Meta, el CRM y la IA.
//
// La respuesta va en streaming (como el Analista) para poder trabajar más de
// los 25 s que una función edge tiene para empezar a contestar.
//
// Reglas:
//   · si alguna cuenta publicitaria no se pudo leer, se reintenta en la
//     siguiente corrida, hasta 2 días: después sale igual, con el aviso dentro;
//   · si el correo falla, el calendario no avanza y se reintenta; a los 3 días
//     de atraso se salta al siguiente envío, para no quedar reintentando siempre;
//   · una cuenta que ya no tiene plan para esto no envía;
//   · si el programa pide revisión (revisar_antes, lo normal), NO le llega al
//     cliente: queda 'por_revisar', se le avisa al dueño, y sale cuando alguien
//     lo aprueba en la app. Una revisión pendiente anterior del mismo programa
//     se descarta: la nueva tiene los números al día.
export const config = { runtime: 'edge' };

import { armarReporte, enviarReporte, avisarParaRevisar, proximoEnvio, hoyColombia, TOPE_PROGRAMAS } from './_reportes.js';
import { planDeCuenta } from './_cupo-agente.js';
import { latir } from './_latido.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
const TOPE_MS = 200000;
const dias = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

async function patch(id, cambio) {
  await fetch(`${SUPABASE_URL}/rest/v1/reportes_programados?id=eq.${id}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(cambio) });
}

async function correr() {
  const hoy = hoyColombia();
  const fin = Date.now() + TOPE_MS;
  const res = { revisados: 0, enviados: 0, para_revisar: 0, reintentar: 0, fallidos: 0, sin_plan: 0, pendientes: 0 };
  const r = await fetch(`${SUPABASE_URL}/rest/v1/reportes_programados?activo=eq.true&proximo_envio=lte.${hoy}&select=*&order=proximo_envio.asc&limit=200`, { headers: H });
  if (!r.ok) throw new Error('Supabase ' + r.status + ' al listar los reportes');
  const programas = await r.json();
  for (const prog of programas) {
    if (Date.now() > fin) { res.pendientes++; continue; }
    res.revisados++;
    const atraso = dias(prog.proximo_envio, hoy);
    try {
      const p = await planDeCuenta(prog.user_id);
      if (p.ok && !(TOPE_PROGRAMAS[p.plan || 'free'] > 0)) {
        res.sin_plan++;
        await patch(prog.id, { proximo_envio: proximoEnvio(prog.frecuencia, hoy) });
        continue;
      }
      const fila = await armarReporte(prog, { hoy });
      if (fila.datos.cuentas_sin_leer?.length && atraso < 2) {
        res.reintentar++;
        await fetch(`${SUPABASE_URL}/rest/v1/reportes_enviados?id=eq.${fila.id}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' },
          body: JSON.stringify({ estado: 'fallido', error: 'No se pudo leer ' + fila.datos.cuentas_sin_leer.join(', ') + '; se reintenta.' }) });
        continue;
      }
      if (prog.revisar_antes !== false) {
        await fetch(`${SUPABASE_URL}/rest/v1/reportes_enviados?programa_id=eq.${prog.id}&estado=eq.por_revisar&id=neq.${fila.id}`, {
          method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ estado: 'vista', error: 'Reemplazado por una versión más nueva' }) });
        await fetch(`${SUPABASE_URL}/rest/v1/reportes_enviados?id=eq.${fila.id}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ estado: 'por_revisar' }) });
        const av = await avisarParaRevisar(fila, prog);
        if (av.error) console.error('[cron-reportes] aviso', prog.id, av.error);
        res.para_revisar++;
        await patch(prog.id, { proximo_envio: proximoEnvio(prog.frecuencia, hoy) });
        continue;
      }
      const e = await enviarReporte(fila, prog, prog.destinatarios);
      if (e.ok) {
        res.enviados++;
        await patch(prog.id, { ultimo_envio: new Date().toISOString(), proximo_envio: proximoEnvio(prog.frecuencia, hoy) });
      } else {
        res.fallidos++;
        if (atraso >= 3) await patch(prog.id, { proximo_envio: proximoEnvio(prog.frecuencia, hoy) });
      }
    } catch (err) {
      res.fallidos++;
      console.error('[cron-reportes]', prog.id, err?.message || err);
      if (atraso >= 3) await patch(prog.id, { proximo_envio: proximoEnvio(prog.frecuencia, hoy) }).catch(() => {});
    }
  }
  return res;
}

export default async function handler(req) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
  }
  await latir('cron-reportes', { empezo: new Date().toISOString() });
  const enc = new TextEncoder();
  return new Response(new ReadableStream({
    async start(ctrl) {
      const latido = setInterval(() => { try { ctrl.enqueue(enc.encode(' ')); } catch {} }, 4000);
      let fin;
      try {
        const res = await correr();
        await latir('cron-reportes', res, res.fallidos ? res.fallidos + ' reportes no salieron' : null);
        fin = { ok: true, ...res };
      } catch (e) {
        await latir('cron-reportes', { error: true }, e?.message || String(e));
        fin = { error: e?.message || 'falló' };
      }
      clearInterval(latido);
      ctrl.enqueue(enc.encode(JSON.stringify(fin)));
      ctrl.close();
    },
  }), { headers: { 'Content-Type': 'application/json' } });
}

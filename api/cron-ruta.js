// api/cron-ruta.js — el empujón diario de la ruta de arranque (ver api/_ruta.js).
//
// Cada mañana (8:00 en Colombia), a cada cuenta nueva que lleva entre 1 y 8
// días le llega UN correo con su siguiente paso pendiente. Nunca con lo que ya
// hizo, nunca dos el mismo día, y nada si ocultó la ruta o ya la terminó: un
// correo diario que no sirve se aprende a borrar sin leer.
//
// Y a Alejandro, un resumen de las cuentas que llevan 2 días sin avanzar: son
// las que hay que llamar antes de que se enfríen (decisión del 15-10-2026).
export const config = { runtime: 'edge' };

import { emailHtml, bloque, pasos, esc, RESPONDER_A } from './_email-layout.js';
import { enviarResend } from './_correo.js';
import { latir } from './_latido.js';
import { PASOS, DIAS, opcionales, detectar, datosDeLaCuenta, armarRuta, RUTA_DESDE } from './_ruta.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const DIA = 86400000;
const TOPE_MS = 20 * 1000;
const AVISAR_A = 'ceo@acuarius.app';
const APP = 'https://app.acuarius.app';

const sb = (extra = {}) => ({ 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, ...extra });

async function usuario(id) {
  return fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(id)}`, { headers: { Authorization: 'Bearer ' + process.env.CLERK_SECRET_KEY } })
    .then(r => (r.ok ? r.json() : null)).catch(() => null);
}

async function guardar(id, cambios) {
  await fetch(`${SUPABASE_URL}/rest/v1/ruta_cuenta?on_conflict=user_id`, {
    method: 'POST', headers: sb({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({ user_id: id, ...cambios, updated_at: new Date().toISOString() }),
  });
}

/** El correo del día. Exportado para pruebas/ruta.mjs. */
export function correoDelDia({ nombre, negocio, ruta, premio }) {
  const pend = ruta.pasos.filter(p => !p.hecho && !(p.opcional && !p.entrada));
  const sig = pend.find(p => p.id === ruta.siguiente) || pend[0];
  const luego = pend.filter(p => p !== sig).slice(0, 2);
  const dia = DIAS[ruta.dia_actual] || {};
  const asunto = `Día ${ruta.dia_actual} de tu arranque: ${sig.titulo.toLowerCase()}`;
  const html = emailHtml({
    titulo: `${esc(nombre ? nombre + ', hoy' : 'Hoy')} toca: ${esc(sig.titulo.toLowerCase())}`,
    intro: `Llevas el <strong>${ruta.progreso.pct} %</strong> de tu ruta de arranque${negocio ? ' en ' + esc(negocio) : ''}. ` +
      `El día ${ruta.dia_actual} es para esto: ${esc((dia.meta || '').toLowerCase())}.`,
    preheader: sig.porque,
    cuerpo: bloque(`<strong>${esc(sig.titulo)}</strong><br>${esc(sig.porque)}`) +
      (luego.length ? '<p style="margin:16px 0 4px;font-size:13px;color:#5A607A">Y cuando tengas un rato:</p>' + pasos(luego.map(p => esc(p.titulo))) : '') +
      (premio ? `<p style="margin:14px 0 0;font-size:13px;color:#5A607A">Si completas los pasos esenciales antes del ${esc(premio)}, ganas 7 días más de Pro.</p>` : ''),
    cta: { texto: sig.boton, url: `${APP}/?ir=ruta` },
    pie: 'Cada paso se marca solo cuando lo haces en Acuarius. Si prefieres no recibir estos correos, oculta la ruta desde Inicio.',
  });
  return { asunto, html };
}

export default async function handler() {
  await latir('cron-ruta', { empezo: new Date().toISOString() });
  const t0 = Date.now();
  const ahora = Date.now();
  let enviados = 0, revisadas = 0, sinTiempo = false;
  const trabadas = [];
  try {
    // Las cuentas que terminaron el alta hace entre 1 y 9 días.
    const desde = new Date(Math.max(RUTA_DESDE, ahora - 9 * DIA)).toISOString();
    const altas = await fetch(`${SUPABASE_URL}/rest/v1/onboarding_cuenta?completado_at=gte.${encodeURIComponent(desde)}&select=user_id,empresa,completado_at&order=completado_at.asc`, { headers: sb() })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))));
    for (const a of altas) {
      if (Date.now() - t0 > TOPE_MS) { sinTiempo = true; break; }
      revisadas++;
      const estado = (await fetch(`${SUPABASE_URL}/rest/v1/ruta_cuenta?user_id=eq.${encodeURIComponent(a.user_id)}&select=*&limit=1`, { headers: sb() })
        .then(r => (r.ok ? r.json() : [])).catch(() => []))?.[0] || {};
      if (estado.oculta_at) continue;
      const inicio = Date.parse(a.completado_at);
      const hechos = detectar(await datosDeLaCuenta(a.user_id));
      const ruta = armarRuta({ pasos: PASOS, hechos, hitos: estado.hitos, opc: opcionales(a.empresa?.sector, a.empresa?.empleados), inicio, ahora });
      // Copia del avance para el panel de cuentas (aunque el dueño no entre).
      if (estado.pct !== ruta.progreso.pct || estado.dia !== ruta.dia_actual || estado.siguiente !== ruta.siguiente) {
        await guardar(a.user_id, { pct: ruta.progreso.pct, dia: ruta.dia_actual, siguiente: ruta.siguiente });
      }
      if (ruta.progreso.hechos >= ruta.progreso.total) continue;

      // ¿Se trabó? Dos días sin cumplir ningún paso nuevo.
      const ultimo = Date.parse(estado.ultimo_avance_at || a.completado_at);
      if (ahora - ultimo > 2 * DIA && (!estado.alerta_at || ahora - Date.parse(estado.alerta_at) > 3 * DIA)) {
        const sig = ruta.pasos.find(p => p.id === ruta.siguiente);
        trabadas.push({ id: a.user_id, negocio: a.empresa?.nombre || '(sin nombre)', sector: a.empresa?.sector || '', dia: ruta.dia_actual, pct: ruta.progreso.pct, en: sig ? sig.titulo : '' });
        await guardar(a.user_id, { alerta_at: new Date(ahora).toISOString() });
      }

      // El día 1 ya tuvo su bienvenida; el correo de la ruta va del 2 al 8.
      if (ruta.dia_actual < 2) continue;
      const clave = String(ruta.dia_actual);
      if ((estado.correos || {})[clave]) continue;
      const u = await usuario(a.user_id);
      const correo = u?.email_addresses?.[0]?.email_address;
      if (!correo) continue;
      const meta = u.public_metadata || {};
      const premio = !estado.premio_at && meta.plan === 'trial' && meta.trial_until && Date.parse(meta.trial_until) > ahora
        ? new Date(meta.trial_until).toLocaleDateString('es-CO', { day: 'numeric', month: 'long' }) : null;
      const { asunto, html } = correoDelDia({ nombre: u.first_name || '', negocio: a.empresa?.nombre || '', ruta, premio });
      const r = await enviarResend('cron-ruta', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'Acuarius <crm@app.acuarius.app>', reply_to: RESPONDER_A, to: [correo], subject: asunto, html }),
      }, a.user_id).catch(() => null);
      if (r?.ok) {
        enviados++;
        await guardar(a.user_id, { correos: { ...(estado.correos || {}), [clave]: new Date().toISOString() } });
      }
    }

    if (trabadas.length) {
      const html = emailHtml({
        titulo: trabadas.length === 1 ? 'Una cuenta nueva se trabó' : `${trabadas.length} cuentas nuevas se trabaron`,
        intro: 'Llevan 2 días sin avanzar en su ruta de arranque. Es el momento de escribirles.',
        cuerpo: pasos(trabadas.map(t => `<strong>${esc(t.negocio)}</strong> · ${esc(t.sector)} · día ${t.dia}, ${t.pct} % · se quedó en «${esc(t.en)}»`)),
        cta: { texto: 'Abrir el panel de cuentas', url: `${APP}/clientes` },
      });
      await enviarResend('cron-ruta-alerta', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'Acuarius <crm@app.acuarius.app>', to: [AVISAR_A], subject: `Ruta de arranque: ${trabadas.length} cuenta${trabadas.length === 1 ? '' : 's'} sin avanzar`, html }),
      }).catch(() => null);
    }
    await latir('cron-ruta', { revisadas, enviados, trabadas: trabadas.length, sinTiempo });
    return new Response(JSON.stringify({ revisadas, enviados, trabadas: trabadas.length, sinTiempo }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    await latir('cron-ruta', { error: true }, e?.message || String(e));
    return new Response(JSON.stringify({ error: e?.message || 'error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// api/cron-notas.js — recordar las notas que nadie ha abierto
//
// Una nota dirigida tardaba en promedio 82 HORAS en leerse. La causa de fondo
// —que casi nadie tenía el push activado— se atacó por otro lado; esto cubre
// lo que queda: la nota que se escribió, llegó, y aun así nadie abrió.
//
// A las 24 horas se recuerda UNA vez. Después no se insiste más: si a las
// cuarenta y ocho horas sigue sin abrirse, el problema no se arregla con otro
// correo, y un recordatorio que se repite solo enseña a filtrarlo.
//
// Un correo por persona con TODAS sus notas pendientes, no uno por nota. Cinco
// correos seguidos de la misma aplicación es la forma más rápida de acabar en
// una regla de «mover a la papelera».
//
// Horario humano a propósito (`vercel.json`: 13:00 y 20:00 UTC, lunes a
// viernes = 8 de la mañana y 3 de la tarde en Colombia). Un recordatorio a las
// tres de la madrugada no se lee: se borra por la mañana con el resto.

import { emailHtml, bloque, esc, RESPONDER_A } from './_email-layout.js';
import { enviarResend } from './_correo.js';
import { yaSeHizo, periodoDe } from './_una-vez.js';
import { latir } from './_latido.js';
import { pedirLista } from './_pedir.js';

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

const sb = () => ({
  'Content-Type': 'application/json',
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
});

const HORAS = 24;
const DIAS_MAXIMO = 7;   // una nota de hace un mes ya no se recuerda: se archiva sola

/** El correo de esa persona: del equipo, o de Clerk si es el dueño. */
async function correoDe(ownerId, quienId) {
  if (quienId !== ownerId) {
    const filas = await fetch(
      `${SUPABASE_URL}/rest/v1/team_members?owner_user_id=eq.${encodeURIComponent(ownerId)}` +
      `&member_user_id=eq.${encodeURIComponent(quienId)}&status=eq.active&select=member_email,member_name&limit=1`,
      { headers: sb() }).then(r => (r.ok ? r.json() : [])).catch(() => []);
    if (filas?.[0]?.member_email) return { correo: filas[0].member_email, nombre: filas[0].member_name };
  }
  const u = await fetch(`https://api.clerk.com/v1/users/${quienId}`, {
    headers: { Authorization: 'Bearer ' + process.env.CLERK_SECRET_KEY },
  }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  return { correo: u?.email_addresses?.[0]?.email_address || null, nombre: u?.first_name || null };
}

export default async function handler(req) {
  const auth = req.headers.get('authorization') || '';
  if (!process.env.CRON_SECRET || !auth.includes(process.env.CRON_SECRET)) {
    return new Response('No autorizado', { status: 401 });
  }

  const corte = new Date(Date.now() - HORAS * 3600000).toISOString();
  const viejo = new Date(Date.now() - DIAS_MAXIMO * 86400000).toISOString();

  let notas;
  try {
    // `recordada_at` es la marca de que ya se avisó de ESTA nota. Sin ella el
    // recordatorio saldría en cada pasada hasta que alguien la abriera.
    notas = await pedirLista(
      `${SUPABASE_URL}/rest/v1/lead_activities?type=eq.nota` +
      `&metadata->>para=not.is.null&metadata->>leida_at=is.null&metadata->>recordada_at=is.null` +
      `&created_at=lt.${encodeURIComponent(corte)}&created_at=gt.${encodeURIComponent(viejo)}` +
      `&select=id,user_id,lead_id,content,created_at,metadata&order=created_at.asc&limit=500`,
      sb(), 'las notas sin leer'
    );
  } catch (e) {
    await latir('cron-notas', { error: true }, e?.message || String(e));
    return new Response(JSON.stringify({ error: e?.message }), { status: 500 });
  }

  if (!notas.length) {
    await latir('cron-notas', { pendientes: 0, sin_pendientes: true });
    return new Response(JSON.stringify({ ok: true, recordadas: 0 }), { headers: { 'Content-Type': 'application/json' } });
  }

  // Agrupadas por destinatario DENTRO de su cuenta: el mismo identificador no
  // se repite entre cuentas, pero el correo sí hay que mandarlo con el dueño
  // correcto para sacar el nombre del equipo.
  const bandejas = {};
  for (const n of notas) {
    const para = n.metadata?.para;
    if (!para) continue;
    const clave = n.user_id + '|' + para;
    (bandejas[clave] = bandejas[clave] || []).push(n);
  }

  const resumen = { personas: 0, recordadas: 0, sin_correo: 0, fallidos: 0 };
  for (const clave of Object.keys(bandejas)) {
    const [ownerId, para] = clave.split('|');
    const suyas = bandejas[clave];

    // Una persona, un recordatorio al día. Aunque le lleguen notas nuevas a lo
    // largo del día, no se le escribe dos veces.
    if (await yaSeHizo(SUPABASE_URL, SUPABASE_KEY, 'notas-sin-leer:' + para, periodoDe('dia'))) continue;

    const { correo, nombre } = await correoDe(ownerId, para);
    if (!correo) { resumen.sin_correo++; continue; }

    // Los nombres de los leads, para que el correo diga de quién es cada nota.
    const ids = [...new Set(suyas.map(n => n.lead_id).filter(Boolean))];
    const leads = ids.length ? await fetch(
      `${SUPABASE_URL}/rest/v1/leads?id=in.(${ids.join(',')})&select=id,name,company`,
      { headers: sb() }).then(r => (r.ok ? r.json() : [])).catch(() => []) : [];
    const porId = {};
    (leads || []).forEach(l => { porId[l.id] = l; });

    const cuantas = suyas.length;
    const cuerpo = suyas.slice(0, 8).map(n => {
      const l = porId[n.lead_id];
      const horas = Math.round((Date.now() - new Date(n.created_at).getTime()) / 3600000);
      return bloque(
        `<b>${esc(l?.name || 'Un contacto')}</b>` +
        (l?.company ? ` <span style="color:#5B6072">· ${esc(l.company)}</span>` : '') +
        `<br><span style="color:#5B6072">hace ${horas} horas</span>` +
        `<br><br>${esc((n.content || '').slice(0, 220))}`
      );
    }).join('');

    let ok = false;
    if (RESEND_API_KEY) {
      try {
        const r = await enviarResend('cron-notas', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Acuarius <crm@app.acuarius.app>',
            reply_to: RESPONDER_A,
            to: [correo],
            subject: cuantas === 1 ? 'Tienes una nota sin abrir' : `Tienes ${cuantas} notas sin abrir`,
            html: emailHtml({
              titulo: nombre ? `${nombre}, te dejaron ${cuantas === 1 ? 'una nota' : cuantas + ' notas'}` : 'Tienes notas sin abrir',
              intro: cuantas === 1
                ? 'Lleva más de un día sin abrirse.'
                : 'Llevan más de un día sin abrirse.',
              preheader: cuantas === 1 ? 'Una nota lleva más de un día esperando' : `${cuantas} notas llevan más de un día esperando`,
              cuerpo,
              cta: { texto: 'Abrir Acuarius', url: 'https://app.acuarius.app/crm' },
              pie: 'Te escribimos una sola vez por cada nota. Si ya las viste, ignora este correo.',
            }),
          }),
        }, ownerId);
        ok = r.ok;
      } catch { ok = false; }
    }

    // Y al teléfono, que es el canal que de verdad llega. Si no lo tiene
    // activado no pasa nada: `enviarPushA` no encuentra suscripción y sigue.
    try {
      const { enviarPushA } = await import('./_push.js');
      await enviarPushA(para, {
        titulo: cuantas === 1 ? 'Una nota sin abrir' : `${cuantas} notas sin abrir`,
        texto: (suyas[0].content || '').slice(0, 110),
        url: '/crm?lead=' + suyas[0].lead_id,
        etiqueta: 'notas-pendientes',
      });
    } catch { /* el push es un extra: que falle no puede tumbar el correo */ }

    // Se marcan aunque el correo falle: si no, mañana se vuelve a intentar con
    // las mismas y la persona acaba recibiendo el mismo recordatorio a diario.
    // El fallo del correo ya queda registrado por `_correo.js`.
    for (const n of suyas) {
      await fetch(`${SUPABASE_URL}/rest/v1/lead_activities?id=eq.${n.id}`, {
        method: 'PATCH', headers: sb(),
        body: JSON.stringify({ metadata: { ...(n.metadata || {}), recordada_at: new Date().toISOString() } }),
      }).catch(() => {});
    }

    resumen.personas++;
    resumen.recordadas += cuantas;
    if (!ok) resumen.fallidos++;
  }

  await latir('cron-notas', resumen, resumen.fallidos ? resumen.fallidos + ' correo(s) no salieron' : null);
  return new Response(JSON.stringify({ ok: true, ...resumen }), { headers: { 'Content-Type': 'application/json' } });
}

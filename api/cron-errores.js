export const config = { runtime: 'edge' };

// api/cron-errores.js
// Avisa de los errores NUEVOS. Cada hora.
//
// La regla que hace que esto se siga leyendo dentro de seis meses: solo avisa
// de firmas que no se hayan avisado nunca. Un error conocido que sigue pasando
// no vuelve a escribir — ya se sabe que está ahí. Y si no hay nada nuevo, no
// manda nada: una alerta que llega cada hora diciendo «ok» se convierte en una
// regla de correo a los tres días, y entonces deja de servir justo el día que
// trae algo importante.

import { emailHtml, bloque, esc, RESPONDER_A } from './_email-layout.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const cab = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};
const AVISAR_A = 'ceo@acuarius.app';

export default async function handler(req) {
  const url = new URL(req.url);
  const secreto = req.headers.get('authorization') || url.searchParams.get('secret') || '';
  if (process.env.CRON_SECRET && !secreto.includes(process.env.CRON_SECRET)) {
    return new Response('No autorizado', { status: 401 });
  }

  const nuevos = await fetch(
    `${SUPABASE_URL}/rest/v1/error_log?avisado_at=is.null&resuelto=is.false` +
    `&select=firma,origen,donde,mensaje,detalle,veces,usuarios,primera_vez&order=veces.desc&limit=25`,
    { headers: cab }
  ).then(r => (r.ok ? r.json() : [])).catch(() => []);

  if (!nuevos.length) {
    return new Response(JSON.stringify({ ok: true, nuevos: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const icono = { navegador: '🖥️', api: '⚙️', cron: '⏱️' };
  const cuerpo = nuevos.slice(0, 10).map(e => bloque(
    `<b>${icono[e.origen] || ''} ${esc(e.mensaje)}</b><br>` +
    `<span style="color:#5B6072">en ${esc(e.donde || 'sitio desconocido')} · ` +
    `${e.veces} ${e.veces === 1 ? 'vez' : 'veces'}` +
    (e.usuarios && e.usuarios.length
      ? ` · ${e.usuarios.length} cuenta${e.usuarios.length > 1 ? 's' : ''} afectada${e.usuarios.length > 1 ? 's' : ''}`
      : '') +
    `</span>` +
    (e.detalle
      ? `<br><span style="color:#5B6072;font-size:12px">${esc(String(e.detalle).split('\n')[0].slice(0, 160))}</span>`
      : ''),
    e.veces > 20 ? '#AE3B2A' : '#A96B05'
  )).join('') + (nuevos.length > 10
    ? `<p style="margin:8px 0 0;color:#5B6072">…y ${nuevos.length - 10} más.</p>`
    : '');

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Acuarius <alertas@app.acuarius.app>',
      reply_to: RESPONDER_A,
      to: [AVISAR_A],
      subject: `⚠️ ${nuevos.length} error${nuevos.length > 1 ? 'es' : ''} nuevo${nuevos.length > 1 ? 's' : ''} en Acuarius`,
      html: emailHtml({
        titulo: `${nuevos.length} error${nuevos.length > 1 ? 'es' : ''} que no se había${nuevos.length > 1 ? 'n' : ''} visto antes`,
        intro: 'Solo se avisa de lo nuevo. Un fallo ya conocido no vuelve a escribir.',
        preheader: String(nuevos[0] && nuevos[0].mensaje || '').slice(0, 90),
        cuerpo,
        pie: '<b>Equipo de Soporte — Acuarius</b>',
      }),
    }),
  }).catch(e => console.error('[errores] no se pudo avisar:', e && e.message));

  // Se marcan como avisados DESPUÉS de mandar. Si el correo falla, se reintenta
  // a la hora siguiente en vez de perderse en silencio.
  await fetch(
    `${SUPABASE_URL}/rest/v1/error_log?firma=in.(${nuevos.map(e => `"${e.firma}"`).join(',')})`,
    {
      method: 'PATCH',
      headers: { ...cab, Prefer: 'return=minimal' },
      body: JSON.stringify({ avisado_at: new Date().toISOString() }),
    }
  ).catch(() => {});

  return new Response(JSON.stringify({ ok: false, nuevos: nuevos.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

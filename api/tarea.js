// api/tarea.js — «Ya la hice», desde el correo y sin entrar a la aplicación.
//
// El resumen diario le llega al comercial a las 12:00 con lo que tiene
// pendiente. Antes, para marcar una como hecha había que abrir Acuarius, buscar
// el lead y tildarla; casi nadie lo hacía, y al día siguiente el CRM decía que
// iba atrasado con trabajo que sí había hecho.
//
// EL ENLACE NO MARCA NADA AL ABRIRSE, a propósito. Los antivirus de correo
// corporativo y los previsualizadores abren los enlaces por su cuenta: con un
// GET que escribiera, las tareas se marcarían solas sin que nadie las tocara y
// el registro del CRM sería mentira. Así que el enlace lleva a una página con
// el nombre de la tarea y un botón. Un toque más, y a cambio nadie marca nada
// sin querer.
//
//   GET  /api/tarea?t=<token>   → la página con el botón
//   POST /api/tarea?t=<token>   → la marca (o la reabre con &deshacer=1)
export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
// El mismo secreto que firma los enlaces de reseñas. Ver api/resenas.js.
const LINK_SECRET = process.env.LINK_SECRET || process.env.CRON_SECRET || '';

const esc = (t) => String(t == null ? '' : t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function sb() {
  return { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
}

async function firma(datos) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(LINK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(datos));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

// Devuelve {actividadId, userId} o null. La comprobación es en tiempo
// constante-ish: no importa tanto aquí como que NO se acepte una firma vacía,
// que es lo que pasaría si LINK_SECRET no estuviera puesto.
async function abrirToken(t) {
  if (!LINK_SECRET || !t) return null;
  const partes = decodeURIComponent(String(t)).split('.');
  if (partes.length !== 2) return null;
  const [datos, mac] = partes;
  if (!mac || (await firma(datos)) !== mac) return null;
  const [actividadId, userId, exp] = datos.split('|');
  if (!actividadId || !userId || !exp) return null;
  // Caduca. Un enlace de un correo de hace tres meses no debería seguir
  // moviendo el CRM de nadie.
  if (Number(exp) < Math.floor(Date.now() / 1000)) return null;
  return { actividadId, userId };
}

function pagina(cuerpo, estado = 200) {
  return new Response(
    `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Acuarius</title>
<style>
  *,*::before,*::after{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#F7F8FC;color:#0D0F1C}
  .c{max-width:440px;margin:12vh auto;background:#fff;border:1px solid #E4E6F0;border-radius:16px;
     padding:30px 26px;text-align:center;box-shadow:0 12px 40px -8px rgba(13,15,28,.12)}
  h1{font-size:20px;margin:0 0 8px;line-height:1.3}
  p{font-size:14.5px;color:#5A607A;line-height:1.6;margin:0 0 20px}
  .tarea{background:#F7F8FC;border:1px solid #E4E6F0;border-radius:11px;padding:14px 16px;
         text-align:left;margin:0 0 20px}
  .tarea b{display:block;font-size:15px;margin-bottom:3px}
  .tarea span{font-size:12.5px;color:#5A607A}
  button,.btn{display:inline-block;background:#1E2BCC;color:#fff;border:0;padding:13px 26px;
    border-radius:10px;font-size:15px;font-weight:700;font-family:inherit;cursor:pointer;text-decoration:none}
  .sec{background:none;color:#5A607A;font-weight:600;font-size:13px;padding:10px;text-decoration:underline}
  .ok{color:#059669;font-size:34px;margin:0 0 10px}
</style></head><body><div class="c">${cuerpo}</div></body></html>`,
    { status: estado, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  );
}

const noSirve = (texto) => pagina(`<h1>Este enlace ya no sirve</h1><p>${esc(texto)}</p>
  <a class="btn" href="https://app.acuarius.app/crm/tareas">Abrir mis tareas</a>`, 410);

export default async function handler(req) {
  const url = new URL(req.url);
  const t = url.searchParams.get('t');
  const datos = await abrirToken(t);
  if (!datos) return noSirve('Puede que haya caducado o que el enlace esté incompleto. Ábrelo desde la aplicación.');

  const filas = await fetch(
    `${SUPABASE_URL}/rest/v1/activities?id=eq.${encodeURIComponent(datos.actividadId)}` +
    `&user_id=eq.${encodeURIComponent(datos.userId)}&select=id,title,due_at,done,cancelled_at,lead_id&limit=1`,
    { headers: sb() }
  ).then((r) => (r.ok ? r.json() : [])).catch(() => []);
  const tarea = filas?.[0];
  if (!tarea) return noSirve('La tarea ya no existe.');
  if (tarea.cancelled_at) return noSirve('Esta tarea se anuló al cerrarse su lead.');

  const cuando = tarea.due_at
    ? new Date(tarea.due_at).toLocaleString('es-CO', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
    : 'Sin fecha';
  const ficha = `<div class="tarea"><b>${esc(tarea.title || 'Tarea')}</b><span>${esc(cuando)}</span></div>`;

  // ── POST: aquí sí se escribe ───────────────────────────────────────────────
  if (req.method === 'POST') {
    const deshacer = url.searchParams.get('deshacer') === '1';
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/activities?id=eq.${encodeURIComponent(tarea.id)}&user_id=eq.${encodeURIComponent(datos.userId)}`,
      { method: 'PATCH', headers: sb(), body: JSON.stringify({ done: !deshacer, updated_at: new Date().toISOString() }) }
    );
    if (!r.ok) {
      return pagina(`<h1>No se pudo guardar</h1><p>Inténtalo otra vez en un momento.</p>
        <a class="btn" href="https://app.acuarius.app/crm/tareas">Abrir mis tareas</a>`, 500);
    }
    if (deshacer) {
      return pagina(`<h1>Listo, vuelve a estar pendiente</h1>${ficha}
        <form method="POST" action="/api/tarea?t=${esc(t)}"><button type="submit">Marcarla como hecha</button></form>`);
    }
    return pagina(`<div class="ok">&#10003;</div><h1>Marcada como hecha</h1>${ficha}
      <p>No hace falta que hagas nada más.</p>
      <a class="btn" href="https://app.acuarius.app/crm/tareas">Ver mis tareas</a>
      <form method="POST" action="/api/tarea?t=${esc(t)}&amp;deshacer=1">
        <button type="submit" class="sec">No era esta, deshacer</button></form>`);
  }

  // ── GET: solo pregunta ─────────────────────────────────────────────────────
  if (tarea.done) {
    return pagina(`<div class="ok">&#10003;</div><h1>Esta ya estaba hecha</h1>${ficha}
      <a class="btn" href="https://app.acuarius.app/crm/tareas">Ver mis tareas</a>
      <form method="POST" action="/api/tarea?t=${esc(t)}&amp;deshacer=1">
        <button type="submit" class="sec">Dejarla otra vez pendiente</button></form>`);
  }
  return pagina(`<h1>¿Ya hiciste esta tarea?</h1>${ficha}
    <form method="POST" action="/api/tarea?t=${esc(t)}"><button type="submit">Sí, ya la hice</button></form>
    <a class="btn sec" href="https://app.acuarius.app/crm/tareas">Todavía no, abrir el CRM</a>`);
}

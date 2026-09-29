// api/_pagina-calendario.js
// La página que ve quien conecta su calendario desde un enlace de reservas.
//
// Esa persona puede no tener cuenta en Acuarius —el barbero al que el dueño le
// mandó el enlace por WhatsApp—, así que no se la puede mandar a la app: el
// catch-all le serviría el shell y la pantalla de entrar, y creería que algo
// salió mal. Se le contesta aquí mismo, con una página que se basta sola.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function paginaCalendario({ ok, titulo, texto, detalle }) {
  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)} · Acuarius</title>
<style>
  :root { --fondo:#F5F6FA; --tarjeta:#FFFFFF; --texto:#14172B; --suave:#5B6072; --bien:#0F766E; --mal:#B42318; --borde:#E4E6EF; --sobre:#FFFFFF; }
  @media (prefers-color-scheme: dark) {
    :root { --fondo:#0E1020; --tarjeta:#171A2E; --texto:#EEF0F8; --suave:#A3A8BD; --bien:#2DD4BF; --mal:#F97066; --borde:#2A2E47; }
  }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    background:var(--fondo); color:var(--texto); font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif; padding:16px; box-sizing:border-box; }
  .t { background:var(--tarjeta); border:1px solid var(--borde); border-radius:16px; padding:28px 24px; max-width:420px; width:100%; text-align:center; }
  .i { width:48px; height:48px; border-radius:50%; margin:0 auto 14px; display:flex; align-items:center; justify-content:center;
    color:var(--sobre); font-size:24px; font-weight:800; background:${ok ? 'var(--bien)' : 'var(--mal)'}; }
  h1 { font-size:20px; margin:0 0 8px; }
  p { margin:0; color:var(--suave); }
  .d { margin-top:14px; font-size:13px; color:var(--suave); word-break:break-word; }
</style></head>
<body><div class="t">
  <div class="i">${ok ? '&#10003;' : '!'}</div>
  <h1>${esc(titulo)}</h1>
  <p>${esc(texto)}</p>
  ${detalle ? `<div class="d">${esc(detalle)}</div>` : ''}
</div></body></html>`;
}

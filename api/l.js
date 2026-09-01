// api/l.js
// La página de aterrizaje pública: /l/<slug>.
//
// Antes esto era un HTML estático que pedía el contenido por JavaScript. Se
// veía bien, pero tenía dos agujeros que solo se notan cuando ya pagaste la
// pauta:
//
//   · Al compartir el enlace por WhatsApp o Facebook no salía NADA — ni
//     título, ni descripción, ni imagen. El robot que hace la vista previa no
//     ejecuta JavaScript: lee el HTML y se va. Y en LatAm el enlace se comparte
//     por WhatsApp más que por ningún otro sitio.
//   · Google indexaba una página en blanco.
//
// Por eso se sirve armada desde el servidor. De paso desaparece el parpadeo de
// «Cargando…» y el píxel dispara antes.
export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function sbHeaders() {
  return { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
}

// El contenido de la página lo escribe su dueño, pero los ajustes acaban
// DENTRO de etiquetas y de scripts, así que cada uno se valida por su forma.
// Un identificador de píxel que no sean dígitos no es un identificador: es
// alguien intentando meter código en la página de otro.
const esc = (t) => String(t == null ? '' : t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function urlSegura(u) {
  const s = String(u || '').trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(s) ? s : '';
}
const pixelMeta = (v) => (/^\d{6,20}$/.test(String(v || '').trim()) ? String(v).trim() : '');
const idGa4 = (v) => (/^G-[A-Z0-9]{4,16}$/i.test(String(v || '').trim()) ? String(v).trim().toUpperCase() : '');

function paginaError(titulo, texto, estado) {
  return new Response(
    `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title>
<meta name="robots" content="noindex">
<style>body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#fff;color:#0F172A}
.c{max-width:420px;margin:16vh auto;text-align:center;padding:0 24px}
h1{font-size:21px;margin:0 0 10px}p{font-size:14.5px;color:#5A607A;line-height:1.65;margin:0}</style>
</head><body><div class="c"><h1>${esc(titulo)}</h1><p>${esc(texto)}</p></div></body></html>`,
    { status: estado, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

export default async function handler(req, contexto) {
  const url = new URL(req.url);
  const slug = (url.searchParams.get('slug') || url.pathname.replace(/^\/l\//, '')).replace(/\/+$/, '');
  if (!slug) return paginaError('Página no encontrada', 'El enlace no parece correcto.', 404);

  let p = null;
  try {
    const filas = await fetch(
      `${SUPABASE_URL}/rest/v1/landings?slug=eq.${encodeURIComponent(slug)}&published=is.true&select=title,html,css,form_token,settings`,
      { headers: sbHeaders() }
    ).then((r) => (r.ok ? r.json() : []));
    p = filas?.[0] || null;
  } catch (e) {
    console.error('[l] no se pudo leer la página:', e.message);
    return paginaError('No se pudo cargar', 'Inténtalo de nuevo en un momento.', 503);
  }
  if (!p) return paginaError('Página no encontrada', 'Puede que el enlace haya cambiado o que la página ya no esté publicada.', 404);

  const aj = p.settings || {};
  const titulo = p.title || 'Página';
  const descripcion = String(aj.descripcion || '').slice(0, 300);
  const imagen = urlSegura(aj.imagen);
  const canonica = `https://app.acuarius.app/l/${slug}`;
  const px = pixelMeta(aj.pixel_meta);
  const ga = idGa4(aj.ga4);
  const redirigir = aj.tras_enviar === 'redirigir' ? urlSegura(aj.url_gracias) : '';

  // La visita se cuenta sin bloquear: la página tiene que pintarse rápido y
  // una métrica no vale un milisegundo del visitante. Lanzarla y olvidarla NO
  // funciona —la función se apaga en cuanto responde y la petición muere por el
  // camino—, de ahí el waitUntil.
  const contar = fetch(`${SUPABASE_URL}/rest/v1/rpc/incrementar_visita_landing`, {
    method: 'POST', headers: sbHeaders(), body: JSON.stringify({ p_slug: slug }),
  }).catch(() => {});
  if (contexto && typeof contexto.waitUntil === 'function') contexto.waitUntil(contar);

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(titulo)}</title>
${descripcion ? `<meta name="description" content="${esc(descripcion)}">` : ''}
<link rel="canonical" href="${esc(canonica)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(titulo)}">
<meta property="og:title" content="${esc(titulo)}">
${descripcion ? `<meta property="og:description" content="${esc(descripcion)}">` : ''}
<meta property="og:url" content="${esc(canonica)}">
${imagen ? `<meta property="og:image" content="${esc(imagen)}">` : ''}
<meta name="twitter:card" content="${imagen ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(titulo)}">
${descripcion ? `<meta name="twitter:description" content="${esc(descripcion)}">` : ''}
${imagen ? `<meta name="twitter:image" content="${esc(imagen)}">` : ''}
<style>
/* Base mínima. El resto del estilo lo trae la página: cada landing es de un
   negocio distinto y no debe oler a Acuarius. */
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0}
img{max-width:100%;height:auto}
.ac-firma{font-family:system-ui,-apple-system,sans-serif;font-size:12px;color:#9aa;text-align:center;padding:22px 16px}
.ac-firma a{color:#6b7280;text-decoration:none}
.ac-ok{background:#ECFDF5;color:#059669;border-radius:10px;padding:14px 16px;font-size:14.5px;text-align:center;font-family:system-ui,-apple-system,sans-serif}
.ac-error{color:#B91C1C;font-size:13px;margin-top:8px;font-family:system-ui,-apple-system,sans-serif}
</style>
<style>${p.css || ''}</style>
${px ? `<script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;
s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${px}');fbq('track','PageView');
</script>` : ''}
${ga ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${ga}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${ga}');</script>` : ''}
</head>
<body>
<div id="pagina">${p.html || ''}</div>
<div class="ac-firma">Hecho con <a href="https://acuarius.app" target="_blank" rel="noopener">Acuarius</a></div>
<script>
(function () {
  var cont = document.getElementById('pagina');
  var token = ${JSON.stringify(p.form_token || '')};
  var redirigir = ${JSON.stringify(redirigir)};

  // Los formularios entran por /api/form-public, la misma puerta que los
  // formularios normales: deduplica, dispara automatizaciones y filtra bots.
  // No se abre una vía nueva solo para las landings.
  var forms = cont.querySelectorAll('form');
  for (var i = 0; i < forms.length; i++) (function (f) {
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!token) return pintarError(f, 'Esta página todavía no está conectada a un formulario.');
      var btn = f.querySelector('button[type=submit], button:not([type]), input[type=submit]');
      var textoBtn = btn ? (btn.textContent || btn.value) : '';
      if (btn) { btn.disabled = true; if (btn.tagName === 'BUTTON') btn.textContent = 'Enviando…'; }

      var datos = {}, campos = f.querySelectorAll('input, textarea, select');
      for (var k = 0; k < campos.length; k++) {
        var c = campos[k];
        if (!c.name || c.type === 'submit') continue;
        datos[c.name] = c.type === 'checkbox' ? (c.checked ? 'sí' : 'no') : c.value;
      }

      fetch('/api/form-public?token=' + encodeURIComponent(token), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos),
      })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (d) {
          if (d && d.error) throw new Error(d.error);
          try { if (window.fbq) fbq('track', 'Lead'); } catch (e) {}
          try { if (window.gtag) gtag('event', 'generate_lead'); } catch (e) {}
          if (redirigir) { location.href = redirigir; return; }
          var ok = document.createElement('div');
          ok.className = 'ac-ok';
          ok.textContent = f.getAttribute('data-gracias') || '¡Gracias! Te contactamos muy pronto.';
          f.parentNode.replaceChild(ok, f);
        })
        .catch(function (err) {
          if (btn) { btn.disabled = false; if (btn.tagName === 'BUTTON') btn.textContent = textoBtn; }
          pintarError(f, err.message || 'No se pudo enviar. Inténtalo de nuevo.');
        });
    });
  })(forms[i]);

  function pintarError(f, texto) {
    var e = f.querySelector('.ac-error');
    if (!e) { e = document.createElement('div'); e.className = 'ac-error'; f.appendChild(e); }
    e.textContent = texto;
  }
})();
</script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Corta, porque el dueño publica cambios y quiere verlos ya; pero
      // suficiente para que una ráfaga de anuncio no golpee la base cada vez.
      'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
    },
  });
}

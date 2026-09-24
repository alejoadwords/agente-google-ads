// public/sw.js — service worker de Acuarius
//
// Aquí SÍ se cachea la aplicación, desde el 23-09-2026. Antes no, y el
// comentario que lo prohibía tenía razón en su momento:
//
//   «se despliega varias veces al día y un usuario con la versión de ayer en
//    caché vería errores imposibles de reproducir»
//
// Lo que cambió es que ese escenario ya tiene quien lo avise. Ese mismo día se
// publicó la barra de «hay una versión nueva» con su botón de actualizar, que
// compara la huella del app.js publicado con la que se cargó. Quedarse atrás
// dejó de ser invisible, así que cachear dejó de ser un arma cargada.
//
// Y hacía falta: instalada en el celular, la aplicación se bajaba 2,2 MB de
// app.js antes de pintar nada. Abrir y ver el logo girando es el delator
// número uno de que aquello es una web, no una app.
//
// La estrategia es «de la caché al instante, y se revalida por detrás»:
//   · se responde con lo guardado, que es lo que hace que abra de golpe
//   · en paralelo se pide la versión nueva y se guarda para la próxima
//   · si cambió, la barra de versión se lo dice al usuario
//
// Lo que NUNCA se cachea, y por qué:
//   · /api/*        — son los datos. Servir un lead viejo sería mentir.
//   · otros dominios — Clerk y las fuentes se gestionan solas.
//   · las peticiones HEAD — la barra de versión pregunta la huella del app.js
//     con HEAD. Si se le respondiera desde la caché, siempre vería la huella
//     vieja, nunca avisaría, y el arreglo se comería a su propia red de
//     seguridad en silencio.

// Subir este número invalida todo lo guardado. Se sube cuando cambia la FORMA
// de cachear, no en cada despliegue: los ficheros se revalidan solos.
const CACHE = 'acuarius-v2';
const OFFLINE = '/offline.html';
const PRECARGA = [OFFLINE, '/icons/icon-192.png', '/icons/icon-512.png'];

// La aplicación. Se guarda al vuelo la primera vez que se pide, no en la
// instalación: precargar 2,2 MB al registrar el service worker castigaría
// justo a quien acaba de entrar por primera vez.
const APP = ['/app.js', '/index.html'];
const esApp = (url) => APP.includes(url.pathname) || url.pathname === '/';

self.addEventListener('install', (e) => {
  // skipWaiting: cuando publicamos un service worker nuevo, entra ya. Sin esto
  // el anterior sigue mandando hasta que el usuario cierra todas las pestañas.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECARGA)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// De la caché al instante; la copia nueva se guarda para la próxima vez.
function deCacheYRevalida(req) {
  return caches.open(CACHE).then((c) => c.match(req).then((hit) => {
    const enRed = fetch(req).then((res) => {
      // Solo se guarda lo que vino bien. Cachear un 500 o el HTML de un error
      // deja la aplicación rota hasta que alguien limpie el navegador, que es
      // justo lo que no queremos volver a pedirle a nadie.
      if (res && res.ok && res.status === 200) c.put(req, res.clone()).catch(() => {});
      return res;
    }).catch(() => null);
    // Con algo guardado se responde YA y la red va por detrás. Sin nada
    // guardado —primera visita— se espera a la red, como antes.
    return hit || enRed.then((r) => r || caches.match(OFFLINE));
  }));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // Solo GET. Un HEAD no se puede guardar en la Cache API, y además es como
  // la barra de versión pregunta la huella: tiene que llegar a la red.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // nada de terceros
  if (url.pathname.startsWith('/api/')) return;      // los datos, siempre frescos

  // Navegación: la carcasa desde la caché para que abra al instante. Ojo, el
  // catch-all de vercel.json devuelve el shell para CUALQUIER ruta que no sea
  // /api, así que se pide siempre '/' y no la ruta concreta: si no, cada
  // pantalla visitada dejaría su propia copia del mismo HTML.
  if (req.mode === 'navigate') {
    e.respondWith(deCacheYRevalida(new Request('/', { credentials: 'same-origin' })));
    return;
  }

  if (esApp(url) || PRECARGA.includes(url.pathname)) {
    e.respondWith(deCacheYRevalida(req));
  }
});
// ── Avisos push ─────────────────────────────────────────────────────────────
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch {}
  const titulo = d.titulo || 'Acuarius';
  e.waitUntil(self.registration.showNotification(titulo, {
    body: d.texto || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    // La etiqueta agrupa: tres leads nuevos seguidos no dejan tres avisos
    // apilados, se reemplazan. Sin esto la pantalla se llena.
    tag: d.etiqueta || 'acuarius',
    renotify: true,
    data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const destino = (e.notification.data && e.notification.data.url) || '/';
  // Si Acuarius ya está abierta, se reutiliza esa ventana en vez de abrir una
  // nueva cada vez: al tercer aviso el usuario tendría cinco pestañas.
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
      for (const c of lista) {
        if (c.url.indexOf(self.location.origin) === 0 && 'focus' in c) {
          c.navigate(destino).catch(() => {});
          return c.focus();
        }
      }
      return self.clients.openWindow(destino);
    })
  );
});

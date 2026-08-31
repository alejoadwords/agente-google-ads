// public/sw.js — service worker de Acuarius
//
// DECISIÓN DELIBERADA: aquí NO se cachea la aplicación.
//
// La tentación de un service worker es guardarse app.js e index.html para que
// abra al instante. En este proyecto eso sería un arma cargada: se despliega
// varias veces al día y un usuario con la versión de ayer en caché vería
// errores imposibles de reproducir, o peor, seguiría usando una versión con un
// fallo que ya arreglamos. La red siempre manda.
//
// Lo único que se guarda es la carcasa mínima para poder decir «estás sin
// conexión» en vez de mostrar el dinosaurio del navegador, y los iconos, que
// no cambian.
//
// Su razón de ser real es otra: sin un service worker registrado no hay
// instalación en la pantalla de inicio ni avisos push.

const CACHE = 'acuarius-carcasa-v1';
const OFFLINE = '/offline.html';
const PRECARGA = [OFFLINE, '/icons/icon-192.png', '/icons/icon-512.png'];

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

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // nada de terceros
  if (url.pathname.startsWith('/api/')) return;      // los datos, siempre frescos

  // Navegación: red primero; si no hay conexión, la página de cortesía.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
    return;
  }

  // Iconos y carcasa: de la caché si están, y se refrescan por detrás.
  if (PRECARGA.includes(url.pathname)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req))
    );
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

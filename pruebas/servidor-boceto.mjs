// Servidor mínimo para mirar los bancos de pruebas en el navegador:
//
//   node pruebas/servidor-boceto.mjs
//   http://localhost:4173/pruebas/banco-reservas.html   ← la pantalla real
//   http://localhost:4173/pruebas/reservar-boceto.html  ← el boceto público
//
// Sirve desde la raíz del repo para que los bancos puedan leer el CSS y el
// código DE VERDAD (public/index.html, public/app.js) en vez de una copia que
// se quedaría vieja al día siguiente.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const RAIZ = new URL('../', import.meta.url);
const TIPOS = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8',
                json: 'application/json; charset=utf-8', css: 'text/css; charset=utf-8' };

createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'pruebas/banco-reservas.html';
  // Nada por encima de la raíz del repo.
  if (p.includes('..')) { res.writeHead(403).end('no'); return; }
  try {
    const b = await readFile(new URL(p, RAIZ));
    res.writeHead(200, { 'content-type': TIPOS[p.split('.').pop()] || 'text/plain; charset=utf-8' });
    res.end(b);
  } catch { res.writeHead(404).end('no está: ' + p); }
}).listen(4173, () => console.log('banco en http://localhost:4173/pruebas/banco-reservas.html'));

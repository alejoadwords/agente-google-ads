// Sirve public/ tal cual, para mirar el móvil en un navegador de verdad antes
// de publicarlo: node pruebas/servidor-publico.mjs
//
// Estático y tonto a propósito. No imita el catch-all de vercel.json: si un
// fichero no está, dice 404. Un servidor de pruebas que devuelve la aplicación
// para cualquier ruta esconde justo los fallos que se vienen a buscar.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../public/', import.meta.url));
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  const ruta = decodeURIComponent((req.url || '/').split('?')[0]);
  // `normalize` impide salirse de public/ con ../
  const rel = normalize(ruta === '/' ? '/movil.html' : ruta).replace(/^(\.\.[/\\])+/, '');
  try {
    const cuerpo = await readFile(join(RAIZ, rel));
    res.writeHead(200, {
      'Content-Type': TIPOS[extname(rel)] || 'application/octet-stream',
      'Cache-Control': 'no-store',   // que cada recarga traiga lo último
    });
    res.end(cuerpo);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('no está: ' + rel);
  }
}).listen(4175, () => console.log('public/ en http://localhost:4175'));

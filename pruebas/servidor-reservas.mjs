// Ejecuta la página pública de reservas EN LOCAL contra la base de verdad:
//
//   node pruebas/servidor-reservas.mjs
//   http://localhost:4174/reservar/<token>
//
// No es una maqueta: sirve `public/reservar.html` tal cual y monta el handler
// REAL de `api/booking-public.js` en `/api/booking-public`. Es la única forma de
// ver que la página y el endpoint se entienden antes de desplegar — y de
// comprobar la carrera de las dos reservas a la misma hora, que en una maqueta
// no se puede reproducir.
//
// La credencial sale del llavero (sesión del CLI de Supabase), nunca de un
// fichero ni de un argumento. Ver la memoria `reference_supabase_admin`.
//
// Usar SIEMPRE con una cuenta de prueba. `pruebas/sembrar-reservas.mjs` crea y
// borra la suya.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';

const PROYECTO = 'qgznzzhkuwxcknmcnrzn';
const RAIZ = new URL('../', import.meta.url);

function tokenDelLlavero() {
  const cru = execSync('security find-generic-password -s "Supabase CLI" -w', { encoding: 'utf8' }).trim();
  return Buffer.from(cru.replace(/^go-keyring-base64:/, ''), 'base64').toString('utf8').trim();
}

async function serviceKey() {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/api-keys?reveal=true`, {
    // Sin User-Agent normal, Cloudflare corta con 403 y el error no tiene nada
    // que ver con el token.
    headers: { Authorization: `Bearer ${tokenDelLlavero()}`, 'User-Agent': 'SupabaseCLI/2.72.7' },
  });
  const j = await r.json();
  if (!r.ok) throw new Error('No se pudo leer la clave: ' + JSON.stringify(j).slice(0, 200));
  const k = j.find(x => x.name === 'service_role');
  if (!k) throw new Error('No aparece la clave service_role');
  return k.api_key;
}

process.env.SUPABASE_URL = `https://${PROYECTO}.supabase.co`;
process.env.SUPABASE_SERVICE_KEY = await serviceKey();
// A propósito sin RESEND_API_KEY: no se le manda un correo de verdad a nadie
// mientras se prueba. El endpoint ya se salta el aviso si no está.

const { default: handler } = await import('../api/booking-public.js');

const TIPOS = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' };

createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost:4174');

  if (u.pathname === '/api/booking-public') {
    let cuerpo = '';
    for await (const trozo of req) cuerpo += trozo;
    const peticion = new Request('https://local' + req.url, {
      method: req.method,
      headers: { 'content-type': req.headers['content-type'] || 'application/json' },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : cuerpo,
    });
    try {
      // Sin `waitUntil`: aquí interesa que los avisos terminen ANTES de
      // responder, para poder ver si fallan.
      const r = await handler(peticion, {});
      res.writeHead(r.status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(await r.text());
    } catch (e) {
      console.error('El endpoint lanzó:', e);
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e && e.message || e) }));
    }
    return;
  }

  // /reservar/<token> y /cita/<token> los resuelve vercel.json en producción.
  const p = /^\/(reservar|cita)\//.test(u.pathname)
    ? 'public/reservar.html'
    : decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'public/reservar.html';
  if (p.includes('..')) { res.writeHead(403).end('no'); return; }
  try {
    const b = await readFile(new URL(p, RAIZ));
    res.writeHead(200, { 'content-type': TIPOS[p.split('.').pop()] || 'text/plain; charset=utf-8' });
    res.end(b);
  } catch { res.writeHead(404).end('no está: ' + p); }
}).listen(4174, () => console.log('reservas en http://localhost:4174/reservar/<token>'));

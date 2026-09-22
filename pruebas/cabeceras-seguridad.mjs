// pruebas/cabeceras-seguridad.mjs — que las cabeceras no tapen lo que sí se incrusta
//
// El CRM no debe poder meterse en un iframe ajeno: con la sesión abierta, una
// web cualquiera podría poner la app invisible encima de sus botones y cobrar
// los clics del usuario. Pero TRES rutas se incrustan a propósito en la web del
// cliente —el formulario, la reserva y la propuesta—, y una regla de más las
// deja en blanco sin avisar: el navegador no da error, simplemente no pinta.
//
// Por eso la regla de `frame-ancestors` lleva una excepción, y esta prueba
// comprueba que la excepción siga cubriendo exactamente esas rutas.

import { readFileSync } from 'node:fs';

const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
let ok = 0, fallos = [];
const comprobar = (q, cond) => { if (cond) ok++; else fallos.push(q); };

const bloques = vercel.headers || [];
comprobar('hay bloque headers', bloques.length > 0);

const claves = b => (b.headers || []).map(h => h.key);
const global = bloques.find(b => claves(b).includes('X-Content-Type-Options'));
const marco = bloques.find(b => claves(b).includes('Content-Security-Policy'));

comprobar('nosniff en todas las rutas', global && global.source === '/(.*)');
comprobar('Referrer-Policy presente', global && claves(global).includes('Referrer-Policy'));
comprobar('Permissions-Policy presente', global && claves(global).includes('Permissions-Policy'));

const permisos = (global?.headers || []).find(h => h.key === 'Permissions-Policy')?.value || '';
// La nota de voz del CRM graba desde el propio dominio: negarlo del todo la
// mataría en silencio (el navegador rechaza getUserMedia sin decir por qué).
comprobar('el micrófono sigue permitido en nuestro dominio', /microphone=\(self\)/.test(permisos));
comprobar('la cámara está negada', /camera=\(\)/.test(permisos));

comprobar('hay regla de frame-ancestors', !!marco);
comprobar('X-Frame-Options acompaña al CSP', marco && claves(marco).includes('X-Frame-Options'));
comprobar('frame-ancestors es self', (marco?.headers || []).some(h => h.key === 'Content-Security-Policy' && /frame-ancestors 'self'/.test(h.value)));

// El `source` de Vercel es un path-to-regexp; el paréntesis se usa tal cual.
const re = new RegExp('^' + (marco?.source || '').replace(/^\//, '\\/') + '$');
const bloqueadas = ['/', '/crm', '/leads/123', '/marketing/campanas', '/analisis'];
const incrustables = ['/form/abc123', '/reservar/tok', '/cita/tok', '/p/tok', '/l/mi-pagina'];

for (const r of bloqueadas) comprobar(`se protege ${r}`, re.test(r));
for (const r of incrustables) comprobar(`se puede incrustar ${r}`, !re.test(r));

console.log(`cabeceras-seguridad: ${ok} comprobaciones ok`);
if (fallos.length) { console.error('FALLOS:\n - ' + fallos.join('\n - ')); process.exit(1); }

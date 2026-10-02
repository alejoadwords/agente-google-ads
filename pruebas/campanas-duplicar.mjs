// Duplicar una campaña la deja en el mismo cliente: node pruebas/campanas-duplicar.mjs
//
// El 01-10-2026 «Duplicar» decía «Copia creada como borrador» y no aparecía
// nada: la copia se guardaba sin client_id (a nivel de cuenta) mientras la
// lista mostraba las del cliente activo. Se ejecuta cmpDuplicar tal cual está
// en public/app.js con la red de mentira.
import { readFileSync } from 'node:fs';

let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + extra : '')); if (!c) mal++; };

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const ini = app.search(/^async function cmpDuplicar\(/m);
const fin = app.indexOf('\n}\n', ini) + 3;
ok(ini > 0, 'cmpDuplicar está en public/app.js');

async function duplicar(clienteActivo) {
  const llamadas = [];
  const mundo = {
    agencyActiveClientId: clienteActivo,
    cmpList: [{ id: 'c1', name: 'Promo', channel: 'sms', body: 'Hola', audience: { tags: ['x'] }, stats: { sent: 3 }, status: 'sent' }],
    fetchAuth: async (url, init) => { llamadas.push({ url, cuerpo: JSON.parse(init.body) }); return new Response(JSON.stringify({ campaign: { id: 'c2' } }), { status: 201 }); },
    showToast: () => {}, cmpRender: () => {},
  };
  const fn = new Function(...Object.keys(mundo), app.slice(ini, fin) + '\nreturn cmpDuplicar;')(...Object.values(mundo));
  await fn('c1');
  return llamadas;
}

let l = await duplicar('ac_123');
ok(l.length === 1 && l[0].url === '/api/campaigns?client_id=ac_123', 'con un cliente activo, la copia se crea en ese cliente', l[0]?.url);
ok(l[0].cuerpo.name === 'Promo (copia)' && l[0].cuerpo.channel === 'sms' && l[0].cuerpo.body === 'Hola' && l[0].cuerpo.audience.tags[0] === 'x', 'con el mismo canal, mensaje y audiencia');
ok(!('stats' in l[0].cuerpo) && !('status' in l[0].cuerpo) && !('id' in l[0].cuerpo), 'sin arrastrar cifras, estado ni id de la original');
l = await duplicar(null);
ok(l[0].url === '/api/campaigns', 'sin cliente activo, a nivel de cuenta', l[0]?.url);

console.log(mal ? `\n${mal} fallos` : '\nTodo en verde');
process.exit(mal ? 1 : 0);

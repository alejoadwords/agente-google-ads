// El cron del catálogo reparte el tiempo entre todas las fuentes:
// node pruebas/catalogo-rotacion.mjs
//
// 30-09-2026: recorría las fuentes siempre en el mismo orden y sin reloj. Si
// la función edge (25 s) se cortaba, las últimas no se actualizaban nunca. Y
// si no podía leer las fuentes devolvía [] y el latido decía «0 fuentes».
// Se ejecuta el cron real; las webs de los clientes son de mentira y lentas.

process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';
process.env.CRON_SECRET = 'cron';
let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra ? ' → ' + extra : '')); if (!c) mal++; };
const resp = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });

let FUENTES = [], caeLista = false, lentoWeb = 0, webs = [];
function sembrar() {
  FUENTES = ['A', 'B', 'C'].map((k, i) => ({ id: 'f' + k, user_id: 'u' + k, client_id: 'c' + k, tipo: 'wordpress', base_url: `https://web${k}.test`, activo: true,
    ultimo_sync: new Date(Date.now() - (10 - i) * 3600e3).toISOString(), cursor_pagina: 1, pase_lote: 40, items: 0 }));
  webs = [];
}
globalThis.fetch = async (url, init = {}) => {
  const u = decodeURIComponent(String(url)), m = init.method || 'GET';
  const web = u.match(/^https:\/\/web([A-C])\.test/);
  if (web) { webs.push(web[1]); if (lentoWeb) await new Promise(r => setTimeout(r, lentoWeb)); return new Response('caída', { status: 503 }); }
  const q = new URL(u.replace('/rest/v1', ''), 'https://x').searchParams;
  if (u.includes('/client_knowledge_sources')) {
    if (m === 'PATCH') { const f = FUENTES.find(x => x.id === q.get('id')?.slice(3)); if (f) Object.assign(f, JSON.parse(init.body)); return new Response(null, { status: 204 }); }
    if (caeLista) return resp({ message: 'caída' }, 503);
    if (!/order=ultimo_sync\.asc\.nullsfirst/.test(u)) return resp(FUENTES);   // sin orden pedido: el de la tabla
    return resp([...FUENTES].sort((a, b) => (a.ultimo_sync || '').localeCompare(b.ultimo_sync || '')));
  }
  return m === 'GET' ? resp([]) : new Response(null, { status: 201 });
};
const cron = (await import('../api/cron-catalogo.js')).default;
const correr = async () => { const r = await cron(new Request('https://x/api/cron-catalogo', { headers: { authorization: 'Bearer cron' } })); return { s: r.status, d: await r.json() }; };

sembrar();
lentoWeb = 700; process.env.CATALOGO_TOPE_MS = '500';
const vistas = [];
for (let i = 0; i < 3; i++) { webs = []; const r = await correr(); vistas.push([...new Set(webs)].join('')); if (i === 0) ok(r.d.sinTiempo === 2, 'con el tiempo justo para una fuente, las otras quedan para la próxima y se dice', JSON.stringify(r.d)); }
lentoWeb = 0; delete process.env.CATALOGO_TOPE_MS;
ok(vistas.join('|') === 'A|B|C', 'en tres pasadas se atiende a las tres, la más atrasada primero (antes: siempre la A)', vistas.join('|'));

sembrar();
caeLista = true;
const r2 = await correr();
caeLista = false;
ok(r2.s === 500 && /no se pudieron leer las fuentes/.test(r2.d.error || ''), 'si no se pueden leer las fuentes, falla a la vista (antes: «0 fuentes»)', JSON.stringify(r2.d));

console.log(mal ? `\n  ${mal} fallo(s)\n` : '\n  Todo en verde\n');
process.exit(mal ? 1 : 0);

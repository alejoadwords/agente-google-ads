// El resumen diario de tareas a escala: node pruebas/resumen-tareas-escala.mjs
//
// Antes (30-09-2026): leía las pendientes de toda la plataforma con tope de
// mil —las vencidas viejas tapaban a las cuentas recientes—, recorría las
// cuentas en serie en 60 s, mandaba un correo por persona (Resend acepta ~2/s)
// y si fallaba la lectura de leads mandaba el resumen SIN las tareas con lead.
// Se ejecuta el cron real contra un Supabase que corta en mil y un Resend de
// mentira.

process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';
process.env.RESEND_API_KEY = 're_x';
process.env.CRON_SECRET = 'cron';
process.env.CLERK_SECRET_KEY = 'sk';
process.env.LINK_SECRET = 'l';
let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra ? ' → ' + extra : '')); if (!c) mal++; };
const resp = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });

let TAREAS = [], LEADS = {}, EQUIPO = {}, ENVIOS = new Set(), lotes = [], fallaResend = 0, fallaLeadsDe = null, lentitud = 0;
function sembrar(cuentas, porCuenta, { vencidasViejas = 0 } = {}) {
  TAREAS = []; LEADS = {}; EQUIPO = {}; ENVIOS = new Set(); lotes = [];
  let n = 0;
  for (let v = 0; v < vencidasViejas; v++) TAREAS.push({ id: 'v' + v, user_id: 'vieja', lead_id: null, title: 'Vieja', type: 'task', due_at: new Date(Date.now() - (400 - v % 300) * 864e5).toISOString() });
  for (let c = 0; c < cuentas; c++) {
    const u = 'u' + String(c).padStart(3, '0');
    EQUIPO[u] = [{ member_user_id: u + '_a', member_email: u + '_a@x.co' }];
    for (let k = 0; k < porCuenta; k++) {
      const lead = 'l' + (n++);
      LEADS[lead] = { id: lead, name: 'Lead ' + lead, phone: null, assigned_to: k % 2 ? u + '_a' : null, deleted_at: null, stage: 'nuevo', closed_at: null };
      TAREAS.push({ id: 't' + n, user_id: u, lead_id: lead, title: 'Seguimiento', type: 'task', due_at: new Date(Date.now() - 3600e3).toISOString() });
    }
  }
}
globalThis.fetch = async (url, init = {}) => {
  const u = decodeURIComponent(String(url)), m = init.method || 'GET';
  if (lentitud) await new Promise(r => setTimeout(r, lentitud));
  if (u.includes('api.clerk.com')) return resp({ email_addresses: [{ email_address: 'dueno@x.co' }] });
  if (u.startsWith('https://api.resend.com')) {
    const cuerpo = JSON.parse(init.body);
    if (fallaResend > 0) { fallaResend--; return resp({ message: 'rate' }, 429); }
    lotes.push(cuerpo.length);
    return resp({ data: cuerpo.map((_, i) => ({ id: 'r' + i })) });
  }
  const tabla = u.split('/rest/v1/')[1]?.split('?')[0];
  const q = new URL(u.replace('/rest/v1', ''), 'https://x').searchParams;
  const off = Number(q.get('offset') || 0), lim = Math.min(Number(q.get('limit') || 1000), 1000);
  if (tabla === 'activities') return resp(TAREAS.slice(off, off + lim));
  if (tabla === 'leads') {
    const ids = (q.get('id') || '').slice(4, -1).split(',');
    if (ids.length > 150) return resp({ message: 'URL demasiado larga' }, 414);
    if (fallaLeadsDe && ids.some(id => TAREAS.find(t => t.lead_id === id)?.user_id === fallaLeadsDe)) return resp({ message: 'caída' }, 503);
    return resp(ids.map(id => LEADS[id]).filter(Boolean));
  }
  if (tabla === 'team_members') return resp(EQUIPO[(q.get('owner_user_id') || '').slice(3)] || []);
  if (tabla === 'cron_envios') {
    if (m === 'POST') { for (const f of JSON.parse(init.body)) ENVIOS.add(f.clave); return new Response(null, { status: 201 }); }
    const claves = (q.get('clave') || '').slice(4, -1).split(',').map(c => c.replace(/^"|"$/g, ''));
    return resp(claves.filter(c => ENVIOS.has(c)).map(clave => ({ clave })));
  }
  return m === 'GET' ? resp([]) : resp({});
};

const mod = await import('../api/cron-tasks.js');
async function correr() {
  let estado = 0, cuerpo = null;
  const res = { status(s) { estado = s; return this; }, json(b) { cuerpo = b; return this; } };
  await mod.default({ headers: { authorization: 'Bearer cron' } }, res);
  return { estado, cuerpo };
}
const personas = () => lotes.reduce((a, b) => a + b, 0);

sembrar(150, 10, { vencidasViejas: 1200 });   // 1.200 viejas + 1.500 recientes
const r1 = await correr();
ok(r1.estado === 200 && r1.cuerpo.cuentas === 151, 'lee las 2.700 tareas y arma las 151 cuentas (con tope de mil, las 150 recientes quedaban fuera)', JSON.stringify(r1.cuerpo).slice(0, 200));
ok(personas() === 301 && lotes.every(n => n <= 100) && lotes.length === 4, 'manda 301 resúmenes en 4 lotes de hasta 100 (antes 301 envíos sueltos)', JSON.stringify(lotes));
const r2 = await correr();
ok(r2.cuerpo.correos === 0 && r2.cuerpo.ya_enviados === 301, 'la corrida de las 12:10 no repite a nadie', JSON.stringify(r2.cuerpo).slice(0, 160));

sembrar(30, 4);
fallaResend = 1;
const r3 = await correr();
ok(r3.cuerpo.fallidos.length > 0 && personas() === 0, 'si Resend rechaza el lote, se dice y no se marca como enviado', JSON.stringify(r3.cuerpo.fallidos.slice(0, 2)));
const r4 = await correr();
ok(r4.cuerpo.correos === 60 && personas() === 60, 'y la corrida siguiente lo manda', JSON.stringify(r4.cuerpo).slice(0, 160));

sembrar(5, 3);
fallaLeadsDe = 'u002';
const r5 = await correr();
fallaLeadsDe = null;
ok(r5.cuerpo.errores.length === 1 && /u002/.test(r5.cuerpo.errores[0]), 'si no se leen los leads de una cuenta, esa cuenta falla a la vista', JSON.stringify(r5.cuerpo.errores));
ok(!ENVIOS.has(`tareas:u002:${new Date().toISOString().slice(0, 10)}`), 'y no recibe un resumen incompleto (antes salía sin las tareas con lead)');
ok(r5.cuerpo.correos === 8, 'las demás cuentas sí lo reciben', r5.cuerpo.correos);

sembrar(40, 2);
lentitud = 300;    // cada consulta tarda 0,3 s y el tope baja a 2 s: no caben las 40
process.env.CRON_TAREAS_TOPE_MS = '2000';
const r6 = await correr();
delete process.env.CRON_TAREAS_TOPE_MS;
lentitud = 0;
ok(r6.cuerpo.sin_tiempo > 0 && r6.cuerpo.correos > 0, 'si no alcanza el tiempo, manda lo que armó y deja el resto (' + r6.cuerpo.sin_tiempo + ' cuentas)', JSON.stringify(r6.cuerpo).slice(0, 160));
const r7 = await correr();
ok(r7.cuerpo.correos === 80 - r6.cuerpo.correos && r7.cuerpo.sin_tiempo === 0, 'y la siguiente corrida completa las que faltaban, sin repetir', JSON.stringify(r7.cuerpo).slice(0, 160));

sembrar(1, 450);   // una cuenta como Certain: 450 leads con tareas
const r8 = await correr();
ok(r8.cuerpo.errores.length === 0 && r8.cuerpo.correos === 2, 'una cuenta con 450 leads con tareas lee sus leads por tandas y recibe su resumen', JSON.stringify(r8.cuerpo).slice(0, 200));

const vercel = JSON.parse((await import('node:fs')).readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
ok(vercel.crons.find(c => c.path === '/api/cron-tasks')?.schedule === '0,10,20 12 * * 1-5', 'corre a las 12:00, 12:10 y 12:20 UTC los días hábiles');

console.log(mal ? `\n  ${mal} fallo(s)\n` : '\n  Todo en verde\n');
process.exit(mal ? 1 : 0);

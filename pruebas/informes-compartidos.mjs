// pruebas/informes-compartidos.mjs
//
// Los informes de Análisis se dibujan en public/informes.js, el MISMO módulo
// para la app, el enlace vivo (/i/<código>) y el PDF (09-10-2026). Esto vigila:
//
//   1. Que las auxiliares copiadas de app.js sigan siendo idénticas: si alguien
//      arregla una allí y no aquí, el enlace y la app dejan de cuadrar.
//   2. Que las cuentas den lo mismo con los mismos datos.
//   3. Que por el enlace público no salgan nombres, teléfonos ni correos.
//   4. Que el servidor lea solo lo de esa cuenta y ese cliente, y que solo
//      pueda compartir quien ve los números enteros.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (f) => readFileSync(join(RAIZ, f), 'utf8');
const app = leer('public/app.js');
const modSrc = leer('public/informes.js');
const api = leer('api/informes-compartidos.js');
const M = await import('../public/informes.js');

let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (c || extra === undefined ? '' : ' → ' + extra)); if (!c) mal++; };
const cuerpo = (src, firma) => {
  const i = src.indexOf(firma);
  if (i < 0) return null;
  // Sin comentarios: lo que se compara es el código, no su explicación.
  return src.slice(i, src.indexOf('\n}\n', i) + 2).replace(/^export /, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s+/g, ' ').trim();
};

console.log('\nLas auxiliares del módulo son las de la app\n');
for (const f of ['function fechaDeCierre(', 'function leadCerrado(', 'function pipeProbFor(', 'function crmFechaLocal(',
                 'function rangoIni(', 'function rangoFin(', 'function rangoDias(', 'function rangoEtiqueta(',
                 'function salesBar(', 'function salesCard(']) {
  const a = cuerpo(app, f), b = cuerpo(modSrc, f) || cuerpo(modSrc, 'export ' + f);
  ok(a && b && a === b, f.replace('function ', '').replace('(', ''), a ? 'distinta' : 'no está en app.js');
}
const constante = (src, n) => (src.match(new RegExp('const ' + n + ' = (\\[[^\\]]*\\])')) || [])[1];
ok(constante(app, 'ETAPAS_CERRADAS') === constante(modSrc, 'ETAPAS_CERRADAS'), 'ETAPAS_CERRADAS');
ok(constante(app, 'TAG_PALETTE') === constante(modSrc, 'TAG_PALETTE'), 'TAG_PALETTE');
const fuentes = (src) => (src.match(/FUENTES_BASE = \[([\s\S]*?)\];/) || [])[1]?.replace(/\s+/g, '');
ok(fuentes(api) && fuentes(api) === fuentes(leer('api/lead-sources.js')), 'FUENTES_BASE del servidor = la de lead-sources');

console.log('\nLas cuentas, con datos de mentira\n');
const hace = (d) => new Date(Date.now() - d * 86400000).toISOString();
const LEADS = [
  { id: 'a', name: 'Katherine Ospino', company: 'Labor Humana', phone: '3001', email: 'k@x.co', stage: 'ganado', value: 100, closed_at: hace(5), created_at: hace(20), updated_at: hace(5), close_reason: 'Precio', assigned_name: 'Camila', source: 'web', pipeline_id: 'p1' },
  { id: 'b', name: 'Rafael Mendoza', company: 'Compensamos', stage: 'perdido', value: 50, closed_at: hace(3), created_at: hace(30), updated_at: hace(3), close_reason: 'No contesta', source: 'referido', pipeline_id: 'p1' },
  { id: 'c', name: 'Jessica Cantillo', stage: 'contactado', value: 70, created_at: hace(12), updated_at: hace(10), source: 'web', pipeline_id: null },
  { id: 'd', name: 'Otro Proceso', stage: 'nuevo', value: 10, created_at: hace(2), updated_at: hace(2), source: 'web', pipeline_id: 'p2' },
];
const PIPES = [{ id: 'p1', name: 'Principal', is_default: true }, { id: 'p2', name: 'Otro' }];
const ETAPAS = [{ key: 'nuevo', label: 'Nuevo', color: '#6B7280' }, { key: 'contactado', label: 'Contactado', color: '#3B82F6' },
  { key: 'ganado', label: 'Ganado', color: '#10B981' }, { key: 'perdido', label: 'Perdido', color: '#9CA3AF' }];
const delProceso = M.leadsDelProceso(LEADS, 'p1', PIPES);
ok(delProceso.map(l => l.id).join() === 'a,b,c', 'el proceso principal se queda con sus leads y los sin proceso');
const v = M.datosVentas({ leads: delProceso, rango: 30 });
ok(v.won.length === 1 && v.lost.length === 1, 'ventas: 1 ganada y 1 perdida en 30 días');
const htmlV = M.htmlVentas({ leads: delProceso, etapas: ETAPAS, rango: 30, interactivo: true });
ok(/Katherine Ospino/.test(htmlV) && /salesExportCsv/.test(htmlV), 'en la app sale el detalle de las ganadas y su descarga');

console.log('\nPor el enlace público no salen datos de los leads\n');
const ctxPub = { leads: delProceso, etapas: ETAPAS, rango: 0, interactivo: false, privado: true,
  acts: [{ id: 't', lead_id: 'c', type: 'task', title: 'Llamar a Jessica', due_at: hace(1), done: false, created_at: hace(4) }],
  inter: [{ lead_id: 'a', type: 'llamada', created_at: hace(19) }],
  equipo: [{ id: 'u1', nombre: 'Camila' }], camps: [], autos: [], logs: [] };
const todo = M.INFORMES.map(i => i.html(Object.assign({}, ctxPub))).join('');
for (const dato of ['Katherine Ospino', 'Rafael Mendoza', 'Jessica Cantillo', 'Labor Humana', 'Compensamos', 'k@x.co', '3001', 'Llamar a Jessica']) {
  ok(!todo.includes(dato), 'no sale «' + dato + '»');
}
ok(!/onclick=/.test(todo), 'sin botones ni clics que lleven a la app');
ok(/no se muestra en el informe compartido/.test(todo), 'y se dice que se omitió, no se esconde en silencio');
ok(/Camila/.test(todo), 'los comerciales sí salen: son del equipo');

console.log('\nEl servidor\n');
ok(/const CAMPOS_LEAD = 'id,stage,value,source,tags,assigned_to,assigned_name,created_at,updated_at,closed_at,close_reason,close_currency,pipeline_id';/.test(api),
   'de los leads solo pide columnas que cuentan');
ok(!/CAMPOS_LEAD[^;]*\b(name|email|phone|notes|custom_fields|company)\b/.test(api.match(/const CAMPOS_LEAD[^;]*;/)[0]), 'ni nombre, ni correo, ni teléfono, ni notas');
ok(/select=id,lead_id,type,due_at,done,created_at,updated_at/.test(api), 'de la agenda, sin el título de las tareas');
ok(/metadata: \(a\.metadata && a\.metadata\.sistema\) \? \{ sistema: true \} : null/.test(api), 'del historial, solo si lo escribió el sistema');
ok(/\.filter\(a => a\.lead_id && idsLeads\.has\(a\.lead_id\)\)/.test(api), 'y solo lo de los leads del informe');
ok((api.match(/user_id=eq\.\$\{U\}/g) || []).length >= 8, 'todas las lecturas van atadas a la cuenta del enlace');
ok(/if \(!\/\^\[a-f0-9\]\{32\}\$\/\.test\(t\)\)/.test(api), 'el código del enlace se valida antes de consultar');
ok(/if \(e\.revocado_at\) return jsonResp\([^)]*410\)/.test(api), 'un enlace desactivado no abre (410)');
ok(/if \(!puedeVer\(quien\.perfil, 'analisis'\) \|\| soloLoSuyo\(quien\.perfil\)\)/.test(api), 'un perfil que solo ve lo suyo no comparte la cuenta');
ok(/alcanceDeCliente\(quien, body\.client_id/.test(api), 'un miembro acotado a un cliente no comparte otro');
ok(/\(p\[0\]\.client_id \|\| null\) !== \(cliente \|\| null\)/.test(api), 'el proceso tiene que ser de esa cuenta y ese cliente');

// Simulacro: el servidor con un Supabase de mentira que devuelve de más.
{
  process.env.SUPABASE_URL = 'https://sb.test';
  const pedidas = [];
  globalThis.fetch = async (u) => {
    pedidas.push(String(u));
    const s = String(u);
    const filas = s.includes('/leads?') ? [{ id: 'a', stage: 'ganado' }]
      : s.includes('/lead_activities?') ? [{ id: 'x', lead_id: 'a', type: 'nota', created_at: hace(1), metadata: { actor: 'Camila', texto: 'secreto' }, content: 'secreto' },
                                           { id: 'y', lead_id: 'OTRO', type: 'nota', created_at: hace(1) }]
      : [];
    return { ok: true, status: 200, json: async () => filas, text: async () => JSON.stringify(filas) };
  };
  const { datosDelEnlace } = await import('../api/informes-compartidos.js');
  const d = await datosDelEnlace({ user_id: 'user_1', client_id: 'pro_main', pipeline_id: null, informes: ['prod', 'equipo'] });
  ok(d.inter.length === 1 && d.inter[0].lead_id === 'a', 'el historial de leads ajenos al informe no sale');
  ok(!JSON.stringify(d.inter).includes('secreto') && !JSON.stringify(d.inter).includes('Camila'), 'ni el texto ni el autor de las notas');
  ok(pedidas.filter(p => p.includes('/leads?')).every(p => p.includes('client_id=eq.pro_main') && p.includes('user_id=eq.user_1')), 'los leads, de esa cuenta y ese cliente');
}

console.log(mal ? `\n${mal} fallo(s)\n` : '\nTodo en orden\n');
process.exit(mal ? 1 : 0);

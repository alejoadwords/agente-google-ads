// pruebas/oportunidades.mjs
//
// Una persona puede tener varias oportunidades, una por proceso, enlazadas por
// `contacto_id` (15-10-2026). Antes la entrada fusionaba por correo o teléfono
// SIN mirar el proceso: quien ya estaba en Venta y llenaba el formulario de
// Arriendo nunca aparecía en Arriendo. Se protege:
//
//   1. La regla de a cuál oportunidad se suma una entrada (función pura).
//   2. intakeLead EJECUTADO contra un Supabase de mentira: en otro proceso abre
//      una oportunidad enlazada; en el mismo, se fusiona; sin proceso, a la
//      abierta más reciente.
//   3. Las conversaciones siguen la misma regla.
//   4. Los datos de contacto se sincronizan entre oportunidades; lo demás no.
//   5. El alta a mano distingue el duplicado de verdad de otra oportunidad.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (f) => readFileSync(join(RAIZ, f), 'utf8');

let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (c || extra === undefined ? '' : ' → ' + extra)); if (!c) mal++; };

const O = await import('../api/_oportunidades.js');
const hace = (d) => new Date(Date.now() - d * 86400000).toISOString();

console.log('\nA cuál oportunidad se suma una entrada\n');
{
  const VENTA = 'p-venta', ARRIENDO = 'p-arriendo';
  const venta = { id: 'L1', pipeline_id: VENTA, stage: 'contactado', created_at: hace(10) };
  const ventaVieja = { id: 'L0', pipeline_id: VENTA, stage: 'perdido', closed_at: hace(40), created_at: hace(60) };
  const cerrada = O.oportunidadCerrada;
  ok(O.aCualSeSuma([venta], { pipelineId: ARRIENDO, explicito: true, principalId: VENTA, cerrado: cerrada }) === null,
     'está en Venta y entra por Arriendo: ninguna, hay que abrir una nueva');
  ok(O.aCualSeSuma([venta], { pipelineId: VENTA, explicito: true, principalId: VENTA, cerrado: cerrada })?.id === 'L1',
     'entra otra vez por Venta: se suma a la de Venta');
  ok(O.aCualSeSuma([ventaVieja, venta], { pipelineId: VENTA, explicito: true, principalId: VENTA, cerrado: cerrada })?.id === 'L1',
     'en el mismo proceso, a la abierta antes que a la cerrada');
  ok(O.aCualSeSuma([{ id: 'S', pipeline_id: null, created_at: hace(5) }], { pipelineId: VENTA, explicito: true, principalId: VENTA, cerrado: cerrada })?.id === 'S',
     'un lead sin proceso cuenta como del principal');
  const arriendo = { id: 'L2', pipeline_id: ARRIENDO, stage: 'nuevo', created_at: hace(1) };
  ok(O.aCualSeSuma([venta, arriendo], { explicito: false, cerrado: cerrada })?.id === 'L2',
     'sin proceso en la entrada: a la abierta más reciente (decisión 2)');
  ok(O.aCualSeSuma([ventaVieja], { explicito: false, cerrado: cerrada })?.id === 'L0',
     'y si todas están cerradas, a la más reciente');
  ok(O.grupoDe({ id: 'A' }) === 'A' && O.grupoDe({ id: 'B', contacto_id: 'A' }) === 'A', 'el grupo es el id de la primera');
  ok(O.filtroDelGrupo('A') === 'or=(id.eq.A,contacto_id.eq.A)', 'y el filtro trae a todas');
}

console.log('\nintakeLead, ejecutado\n');
{
  process.env.SUPABASE_URL = 'https://sb.test';
  process.env.SUPABASE_SERVICE_KEY = 'x';
  const BASE = { id: 'L1', user_id: 'u1', client_id: 'pro_main', name: 'Ana Pérez', email: 'ana@x.co', phone: '+57 300 111 2233',
                 pipeline_id: 'p-venta', stage: 'contactado', created_at: hace(10), tags: [], notes: null };
  let llamadas = [];
  globalThis.fetch = async (u, o = {}) => {
    const url = String(u), metodo = o.method || 'GET';
    llamadas.push({ url, metodo, cuerpo: o.body ? JSON.parse(o.body) : null });
    let filas = [];
    if (metodo === 'GET' && url.includes('/leads?') && (url.includes('email=eq.') || url.includes('phone=like.'))) filas = [BASE];
    else if (metodo === 'GET' && url.includes('/pipelines?') && url.includes('id=eq.')) filas = [{ id: url.match(/id=eq\.([^&]+)/)[1] }];
    else if (metodo === 'GET' && url.includes('/pipelines?')) filas = [{ id: 'p-venta', is_default: true }, { id: 'p-arriendo' }];
    else if (metodo === 'POST' && url.includes('/leads')) filas = [{ ...JSON.parse(o.body), id: 'NUEVO', created_at: new Date().toISOString() }];
    const txt = JSON.stringify(filas);
    return { ok: true, status: 200, text: async () => txt, json: async () => filas, headers: { get: () => null } };
  };
  const { intakeLead } = await import('../api/_lead-intake.js');
  const creadas = () => llamadas.filter(l => l.metodo === 'POST' && /\/rest\/v1\/leads$/.test(l.url));
  const fusiones = () => llamadas.filter(l => l.metodo === 'PATCH' && l.url.includes('/leads?id=eq.L1'));

  llamadas = [];
  const a = await intakeLead('u1', 'pro_main', { name: 'Ana', email: 'ana@x.co', pipelineId: 'p-arriendo', source: 'web' });
  const c = creadas()[0]?.cuerpo || {};
  ok(a.created && creadas().length === 1, 'está en Venta y llena el formulario de Arriendo: se abre una oportunidad nueva');
  ok(c.pipeline_id === 'p-arriendo' && c.contacto_id === 'L1', 'en Arriendo, enlazada a la de Venta', JSON.stringify({ p: c.pipeline_id, g: c.contacto_id }));
  ok(c.phone === '+57 300 111 2233', 'con los datos de contacto que ya tenía (el teléfono no venía en el formulario)');
  ok(a.otraOportunidadDe === 'L1', 'y quien llama sabe que es otra oportunidad de la misma persona');

  llamadas = [];
  const b = await intakeLead('u1', 'pro_main', { name: 'Ana', email: 'ana@x.co', pipelineId: 'p-venta', source: 'web', note: 'otra vez' });
  ok(!b.created && creadas().length === 0 && fusiones().length === 1, 'entra otra vez por Venta: se fusiona, como siempre');

  llamadas = [];
  const d = await intakeLead('u1', 'pro_main', { name: 'Ana', phone: '3001112233', source: 'webhook', note: 'sin proceso' });
  ok(!d.created && creadas().length === 0 && fusiones().length === 1, 'sin proceso en la entrada: se suma a la que tiene');

  llamadas = [];
  const e = await intakeLead('u1', 'pro_main', { name: 'Nuevo', email: 'otra@x.co'.replace('otra', 'nadie'), pipelineId: 'p-arriendo', source: 'web' });
  // (el simulacro devuelve a Ana para cualquier correo: este caso solo vigila que no se rompa)
  ok(e && e.lead, 'la entrada no se rompe');
}

console.log('\nLas otras puertas siguen la misma regla\n');
{
  const inbox = leer('api/_inbox-engine.js');
  const conv = inbox.slice(inbox.indexOf('export async function upsertLeadFromConversation'), inbox.indexOf('// ── Ver las imágenes'));
  ok(/oportunidadesDe\(leer, userId, clientId \|\| null/.test(conv), 'una conversación nueva busca si la persona ya es un lead');
  ok(/aCualSeSuma\(suyas, \{ pipelineId, explicito: !!pipelineId/.test(conv), 'con la misma regla: el proceso del canal manda');
  ok(/lead_id: suma\.id/.test(conv) && /return suma\.id;/.test(conv), 'si encuentra a cuál, la conversación se engancha a ella');
  ok(/contacto_id: grupoDe\(yaExiste\)/.test(conv), 'si no, abre una oportunidad enlazada');

  const leads = leer('api/leads.js');
  ok(/for \(const k of CAMPOS_DE_CONTACTO\) if \(update\[k\] !== undefined\) deContacto\[k\] = update\[k\];/.test(leads),
     'editar nombre, correo, teléfono o empresa se sincroniza (decisión 1)');
  ok(JSON.stringify(O.CAMPOS_DE_CONTACTO) === JSON.stringify(['name', 'email', 'phone', 'company']), 'y solo eso: etapa, valor, responsable y notas son de cada oportunidad');
  ok(/&\$\{filtroDelGrupo\(grupo\)\}&id=neq\.\$\{encodeURIComponent\(id\)\}&deleted_at=is\.null/.test(leads), 'a las demás del grupo, dentro de la cuenta');
  ok(/otro_proceso: true, proceso/.test(leads), 'el alta a mano dice si la persona está en otro proceso');
  ok(/ya_en_proceso/.test(leads), 'y no deja abrir una segunda en el mismo proceso');
  ok(/id: \(!soloLosMios \|\| f\.assigned_to === actorId\) \? f\.id : null/.test(leads), 'quien solo ve lo suyo sabe que existe la otra, pero no la abre');

  const app = leer('public/app.js');
  ok(/function lfCargarOportunidades\(/.test(app) && /Oportunidades de esta persona/.test(app), 'la ficha muestra sus otras oportunidades');
  ok(/oportunidad_de: origen\.id, pipeline_id: pipelineId/.test(app), 'y abre una en otro proceso');
  ok(/oportunidad_de: dup\.id/.test(app), 'el aviso de duplicado ofrece abrirla enlazada');
}

console.log('\nCampañas: una persona, un envío; la baja es de la persona\n');
{
  process.env.SUPABASE_URL = 'https://sb.test';
  const LEADS = [
    { id: 'A1', name: 'Ana', email: 'ana@x.co', phone: '3001110000', contacto_id: null, tags: [] },
    { id: 'A2', name: 'Ana', email: 'ANA@x.co ', phone: '3001110000', contacto_id: 'A1', tags: [] },   // misma persona, otro proceso
    { id: 'B1', name: 'Beto', email: 'beto@x.co', phone: '3002220000', contacto_id: null, tags: [] },
    { id: 'C1', name: 'Caro', email: 'caro@x.co', phone: '3003330000', contacto_id: null, tags: [] },
  ];
  // Caro se dio de baja desde OTRA oportunidad suya (C2), que no está en la audiencia.
  const BAJAS = [{ id: 'C2', email: 'caro@x.co', phone: '3003330000' }];
  globalThis.fetch = async (u) => {
    const url = String(u);
    let filas = [];
    if (url.includes('/leads?') && url.includes('tags=cs.')) filas = BAJAS;
    else if (url.includes('/leads?')) filas = LEADS;
    const txt = JSON.stringify(filas);
    return { ok: true, status: 200, json: async () => filas, text: async () => txt, headers: { get: () => null } };
  };
  const C = await import('../api/campaigns.js');
  const r = await C.resolveAudience('u1', 'pro_main', { tags: ['x'] }, 'email');
  const ids = r.leads.map(l => l.id).sort().join();
  ok(ids === 'A1,B1', 'Ana recibe una vez y Caro, dada de baja en otra oportunidad, no recibe', ids);
  ok(r.repetidos === 1 && r.bajaPorOtra === 1, 'y se cuenta cada cosa para enseñarla antes de enviar', JSON.stringify({ rep: r.repetidos, baja: r.bajaPorOtra }));
  const w = C.unaPorPersona([{ id: 'X', phone: '+57 300 999 8888' }, { id: 'Y', phone: '3009998888', contacto_id: 'Z' }], 'whatsapp');
  ok(w.leads.length === 1 && w.repetidos === 1, 'en WhatsApp la persona es su teléfono, escrito como venga');
  const app = leer('public/app.js');
  ok(/b\.repetidos \? linea\('Una sola vez', b\.repetidos/.test(app), 'el asistente de campañas lo dice');
}

console.log('\nTablero, inbox, Resumen y móvil\n');
{
  const leads = leer('api/leads.js');
  const app = leer('public/app.js');
  const movil = leer('public/movil-app.js');
  const inf = leer('public/informes.js');
  ok(/await conOtrosProcesos\(filas \|\| \[\], userId, clientId\)/.test(leads), 'la lista trae en qué otros procesos está cada persona');
  ok(/crmOtrosProcesosHtml\(lead\)/.test(app) && /crmOtrosProcesosHtml\(l\)/.test(app) && /' También en '/.test(app), 'la tarjeta y la lista dicen «También en …»');
  ok(/inboxPintarOportunidades\(conv\.lead_id\)/.test(app), 'la conversación enseña sus otras oportunidades');
  ok(/onclick="crmIrALeadODecirlo\('\$\{esc\(conv\.lead_id\)\}'\)"/.test(app), 'y «Ver lead» abre aunque esté en otro tablero');
  ok(/personas distintas/.test(inf) && /new Set\(leads\.map\(l => l\.contacto_id \|\| l\.id\)\)\.size/.test(inf), 'el Resumen de todos los procesos distingue personas de oportunidades');
  ok(/if \(r\.status === 409 && d\.duplicado\)/.test(movil) && /oportunidad_de: _dupId/.test(movil), 'el móvil entiende el duplicado y ofrece la oportunidad enlazada');
  ok(!/cerrarChicharra|bbtn sec"/.test(movil), 'sin nombres ni clases inventadas');
}

console.log(mal ? `\n${mal} fallo(s)\n` : '\nTodo en orden\n');
process.exit(mal ? 1 : 0);

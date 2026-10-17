// Proyecto SEO completo (fase 1): node pruebas/seo-proyectos.mjs
//
// Lo puro (_seo.js, el dashboard public/seo-panel.js) y lo de red EJECUTADO
// con fetch simulado (el enlace público, la cola de GEO), no solo leído.
import { readFileSync } from 'fs';
process.env.SUPABASE_URL = 'https://sb.test';
process.env.SUPABASE_SERVICE_KEY = 'k';

let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 300) : '')); if (!c) mal++; };
const S = await import('../api/_seo.js');
const P = await import('../public/seo-panel.js');

console.log('\nDominio y marca');
ok(S.dominio('https://www.CertainPezzano.com/arriendo?x=1') === 'certainpezzano.com', 'dominio limpio');
ok(S.terminosMarca('certainpezzano.com', 'Certain & Pezzano').includes('certain y pezzano'), 'la marca se reconoce con «&» o «y»');

console.log('\nLeer la respuesta de una IA');
const ctx = { dominio: 'certainpezzano.com', marca: 'Certain & Pezzano', competidores: ['fincaraiz.com.co', 'metrocuadrado.com'] };
let l = S.leerRespuesta('Te recomiendo Fincaraiz para buscar, y la inmobiliaria Certain y Pezzano en Barranquilla.', ctx);
ok(l.mencionada && l.posicion === 2 && l.competidores.includes('fincaraiz.com.co'), 'menciona la marca (con «y»), en 2.º lugar tras un competidor', l);
ok(l.citada === null, 'sin fuentes, «citada» queda sin saber (no es un no)');
l = S.leerRespuesta('Revisa portales de arriendo.', ctx, ['https://www.certainpezzano.com/arriendo', 'https://fincaraiz.com.co/x']);
ok(!l.mencionada && l.citada === true, 'mencionada ≠ citada: la IA puede citar la web sin nombrar la marca');
ok(S.leerRespuesta('Prueba con CertainPezzano', ctx).mencionada, 'también pegado o con otra capitalización');

console.log('\nFechas y plantilla');
ok(S.tocaMedirPosiciones(null) && !S.tocaMedirPosiciones(S.hoyCO()) && S.tocaMedirPosiciones('2020-01-01'), 'posiciones: cada 7 días');
ok(S.hoyCO(new Date('2026-10-20T03:00:00Z')) === '2026-10-19', 'el día es el de Colombia, no el de UTC');
const ini = S.accionesIniciales('p1', '2026-10-05');
ok(ini.length === S.PLANTILLA_INICIAL.length && ini.every(a => a.mes === '2026-10' && a.plantilla.startsWith('inicial-')), 'la configuración inicial va al mes de inicio, marcada como plantilla');
ok(S.isoDe(1791947795658).startsWith('2026-') && S.isoDe('2026-07-01') && S.isoDe('basura') === null, 'fechas del blob viejo: milisegundos o texto');
const m = S.desdeBlob({ createdAt: 1783357912000, keywords: [{ kw: 'a', history: { '2026-08': { pos: 3, checkedAt: 1786476739564 }, '2026-07': { pos: null, checkedAt: 1785515770099 } } }],
  geoQueries: [{ q: '¿quién?' }], geoHistory: { '2026-09': { results: [{ query: '¿quién?', engine: 'claude', mentioned: true, rank: 1 }] } }, actions: [{ text: 'Hecho', done: true }] });
ok(m.kws[0].historial.length === 2 && m.kws[0].historial[0].fecha < m.kws[0].historial[1].fecha, 'migración: historial ordenado por fecha');
ok(m.geo[0].mencionada === true && m.acciones[0].estado === 'hecha', 'migración: GEO y acciones');

console.log('\nLa cola de GEO');
const MD = await import('../api/_seo-medir.js');
const preguntas = [{ id: 'q1' }, { id: 'q2' }];
let cola = MD.pendientesGeo(preguntas, ['claude', 'gemini'], []);
ok(cola.length === 2 * 2 * S.CORRIDAS_GEO, '3 corridas por pregunta y por IA');
ok(cola.slice(0, 4).every(t => t.corrida === 1), 'primero la corrida 1 de todo: con poco cupo, al menos una vuelta completa');
const viejo = new Date(Date.now() - 7 * 3600 * 1000).toISOString(), reciente = new Date().toISOString();
cola = MD.pendientesGeo([{ id: 'q1' }], ['claude'], [{ pregunta_id: 'q1', motor: 'claude', corrida: 1, error: 'x', creado_at: viejo }, { pregunta_id: 'q1', motor: 'claude', corrida: 2, error: 'x', creado_at: reciente }, { pregunta_id: 'q1', motor: 'claude', corrida: 3, error: null, creado_at: viejo }]);
ok(cola.length === 1 && cola[0].corrida === 1, 'un error se reintenta pasadas 6 horas, no en cada vuelta', cola);
ok(MD.posicionEn([{ link: 'https://otro.com', position: 1 }, { link: 'https://blog.certainpezzano.com/x', position: 2 }], 'certainpezzano.com').pos === 2, 'la posición cuenta subdominios del sitio');

console.log('\nEl dashboard (el mismo para la app y el cliente)');
const datos = {
  proyecto: { id: 'p', nombre: 'Certain', dominio: 'certainpezzano.com', marca: 'Certain & Pezzano', pais: 'co', inicio: '2026-08-10' },
  clusters: [{ id: 'c1', nombre: 'Arriendo', pagina_pilar: 'https://x/arriendo' }],
  keywords: [{ id: 'k1', kw: 'arriendo barranquilla', cluster_id: 'c1' }, { id: 'k2', kw: 'apartamentos norte', cluster_id: null }, { id: 'k3', kw: 'casas venta', cluster_id: 'c1' }],
  posiciones: [
    { keyword_id: 'k1', fecha: '2026-09-01', pos: 12 }, { keyword_id: 'k1', fecha: '2026-10-01', pos: 6 },
    { keyword_id: 'k2', fecha: '2026-09-01', pos: null }, { keyword_id: 'k2', fecha: '2026-10-01', pos: 40 },
    { keyword_id: 'k3', fecha: '2026-09-01', pos: 30 }, { keyword_id: 'k3', fecha: '2026-10-01', pos: null }],
  top: [{ keyword_id: 'k1', top: [{ pos: 1, url: 'https://fincaraiz.com.co/a', dominio: 'fincaraiz.com.co' }] }],
  preguntas: [{ id: 'q1', pregunta: '¿Inmobiliaria en Barranquilla?' }],
  geo: [
    { pregunta_id: 'q1', periodo: '2026-09', motor: 'chatgpt', corrida: 1, mencionada: false },
    { pregunta_id: 'q1', periodo: '2026-10', motor: 'chatgpt', corrida: 1, mencionada: true, fragmento: '…Certain…' },
    { pregunta_id: 'q1', periodo: '2026-10', motor: 'chatgpt', corrida: 2, mencionada: false },
    { pregunta_id: 'q1', periodo: '2026-10', motor: 'chatgpt', corrida: 3, mencionada: true },
    { pregunta_id: 'q1', periodo: '2026-10', motor: 'perplexity', corrida: 1, mencionada: false, citada: true, citas: ['https://certainpezzano.com/a'] },
    { pregunta_id: 'q1', periodo: '2026-10', motor: 'gemini', corrida: 1, error: 'caída' }],
  acciones: [{ id: 'a1', mes: '2026-08', categoria: 'onpage', titulo: 'Títulos <script>', estado: 'hecha', plantilla: 'inicial-7' }, { id: 'a2', mes: '2026-10', categoria: 'contenido', titulo: 'Blog', estado: 'pendiente' }],
  ultimaMedicion: '2026-10-01',
};
const series = P.seriesDeKeywords(datos);
const k = Object.fromEntries(series.map(s => [s.id, s]));
ok(k.k1.cambio === 6 && k.k2.entro && k.k3.salio, 'sube 6 puestos; entrar o salir de los 100 primeros también cuenta', series.map(s => [s.id, s.cambio, s.entro, s.salio]));
const r = P.resumenPosiciones(series);
ok(r.suben === 2 && r.bajan === 1 && r.enTop10 === 1, 'resumen: suben/bajan incluye entradas y salidas', r);
ok(P.porCluster(datos, series).find(g => g.nombre === 'Sin clúster')?.keywords.length === 1, 'las keywords sin clúster se agrupan aparte');
const g = P.resumenGeo(datos, '2026-10');
ok(g.total === 4 && g.menciones === 2 && g.tasa === 50 && g.corridas === 3, 'GEO: 2 de 4 respuestas (los errores no cuentan), 3 corridas', g);
ok(g.motores.perplexity.citada === 1 && g.fuentes[0][0] === 'certainpezzano.com', 'GEO: citas y fuentes');
ok(P.periodosGeo(datos).join() === '2026-09,2026-10', 'periodos con datos');
const meses = P.mesesCronograma(datos, new Date('2026-10-17'));
ok(meses.map(x => x.mes).join() === '2026-08,2026-09,2026-10' && meses[2].numero === 3, 'cronograma: todos los meses desde el inicio, aunque uno no tenga acciones');
for (const [sec] of P.SECCIONES) {
  let html = '';
  try { html = P.panelSeo(datos, { seccion: sec, agencia: 'Acuarius' }); } catch (e) { html = 'ERROR ' + e.message; }
  ok(html.includes('seo-doc') && !html.includes('ERROR') && !html.includes('undefined') && !html.includes('NaN'), 'la sección «' + sec + '» se dibuja sin undefined ni NaN');
}
ok(!P.panelSeo(datos, { seccion: 'cronograma' }).includes('<script>'), 'el texto se escapa');
const vacio = { proyecto: { nombre: 'X', dominio: 'x.com' }, clusters: [], keywords: [], posiciones: [], top: [], preguntas: [], geo: [], acciones: [] };
ok(P.SECCIONES.every(([s]) => { try { return !P.panelSeo(vacio, { seccion: s }).includes('undefined'); } catch { return false; } }), 'un proyecto recién creado (sin datos) se dibuja en todas las secciones');
ok(P.panelSeo(datos, { seccion: 'geo' }).includes('Cada pregunta se repite 3 veces') && !P.panelSeo({ ...datos, geo: datos.geo.filter(x => x.corrida === 1) }, { seccion: 'geo' }).includes('se repite'), 'solo dice «se repite N veces» cuando de verdad se repitió');

console.log('\nEl enlace público, ejecutado (fetch simulado)');
{
  const pub = (await import('../api/seo-publico.js')).default;
  const tabla = { enlace: null };
  const antes = globalThis.fetch;
  const pedidas = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url); pedidas.push((init.method || 'GET') + ' ' + u);
    const res = (b, st = 200) => new Response(JSON.stringify(b), { status: st });
    if (u.includes('/seo_enlaces?token=')) return res(tabla.enlace ? [tabla.enlace] : []);
    if (u.includes('/seo_enlaces?id=')) return res([]);
    if (u.includes('/seo_proyectos?')) return res([{ id: 'p', user_id: 'user_x', client_id: 'cli', nombre: 'Certain', dominio: 'certainpezzano.com', inicio: '2026-08-01' }]);
    if (u.includes('/seo_acciones?')) return res([{ id: 'a', titulo: 'visible', visible_cliente: true }]);
    if (u.includes('/onboarding_cuenta?')) return res([{ empresa: { nombre: 'Agencia Uno' } }]);
    return res([]);
  };
  try {
    const pedir = (t) => pub(new Request('https://app.acuarius.app/api/seo-publico?t=' + t));
    ok((await pedir('corto')).status === 404, 'código mal formado → 404, sin consultar la base');
    ok((await pedir('a'.repeat(32))).status === 404, 'código que no existe → 404');
    tabla.enlace = { id: 'e', proyecto_id: 'p', user_id: 'user_x', vistas: 2, revocado_at: '2026-10-01' };
    ok((await pedir('a'.repeat(32))).status === 410, 'enlace desactivado → 410 y lo dice');
    tabla.enlace.revocado_at = null;
    const resp = await pedir('a'.repeat(32));
    const d = await resp.json();
    ok(resp.status === 200 && d.proyecto.nombre === 'Certain' && d.agencia === 'Agencia Uno', 'enlace vivo → el proyecto y quién lo prepara', d);
    ok(!('user_id' in d.proyecto) && !('client_id' in d.proyecto), 'no expone la cuenta ni el cliente');
    ok(pedidas.some(p => p.includes('/seo_acciones?') && p.includes('visible_cliente=eq.true')), 'solo las acciones visibles para el cliente');
    ok(pedidas.some(p => p.startsWith('PATCH') && p.includes('/seo_enlaces?id=eq.e')), 'cuenta la visita');
    ok(resp.headers.get('x-robots-tag') === 'noindex' && resp.headers.get('cache-control') === 'no-store', 'noindex y sin caché');
  } catch (e) { ok(false, 'el enlace público no revienta al ejecutarse', e.message); }
  finally { globalThis.fetch = antes; }
}

console.log('\nFase 2: calendario de contenido');
ok(S.transicionContenido('borrador', 'enviar', 'agencia').estado === 'en_revision' && S.transicionContenido('cambios', 'enviar', 'agencia').estado === 'en_revision', 'la agencia envía a revisión un borrador o una pieza con cambios');
ok(S.transicionContenido('en_revision', 'publicar', 'agencia').error && S.transicionContenido('aprobado', 'publicar', 'agencia').estado === 'publicado', 'solo se publica lo aprobado');
ok(S.transicionContenido('en_revision', 'aprobar', 'cliente').estado === 'aprobado' && S.transicionContenido('en_revision', 'cambios', 'cliente').estado === 'cambios', 'el cliente aprueba o pide cambios a lo que está en revisión');
ok(S.transicionContenido('borrador', 'aprobar', 'cliente').error && S.transicionContenido('aprobado', 'aprobar', 'cliente').error, 'no aprueba un borrador ni dos veces');
ok(S.transicionContenido('borrador', 'enviar', 'cliente').error, 'el cliente no puede mandar a revisión');
ok(S.editableContenido('borrador') && S.editableContenido('cambios') && !S.editableContenido('en_revision') && !S.editableContenido('aprobado'), 'el texto no cambia por debajo mientras se revisa o después de aprobado');

const dc = { ...datos,
  contenidos: [
    { id: 'c-bor', titulo: 'Guía de barrios', tipo: 'articulo', fecha: '2026-11-03', estado: 'borrador', cuerpo: 'SECRETO DEL BORRADOR' },
    { id: 'c-rev', titulo: 'Arriendo en el norte', tipo: 'articulo', fecha: '2026-10-20', estado: 'en_revision', cuerpo: 'Párrafo uno.\n\nPárrafo <b>dos</b>.', version: 2 },
    { id: 'c-apr', titulo: 'Landing', tipo: 'landing', fecha: null, estado: 'aprobado', aprobado_por: 'Marilia', aprobado_at: '2026-10-15T10:00:00Z' }],
  comentarios: [{ contenido_id: 'c-rev', autor_tipo: 'cliente', autor_nombre: 'Marilia', accion: 'cambios', texto: 'Cambia el título', creado_at: '2026-10-16T10:00:00Z', version: 1 }] };
const lista = P.panelSeo(dc, { seccion: 'contenido', vistaCliente: true });
ok(lista.includes('Planeado') && lista.includes('Para revisar') && lista.includes('esperando tu revisión'), 'el cliente ve «Planeado» y lo que tiene para revisar');
ok(!lista.includes('SECRETO'), 'la lista nunca muestra el texto');
ok(P.panelSeo(dc, { seccion: 'contenido', vistaCliente: false }).includes('Esperando al cliente'), 'la agencia ve sus propias etiquetas');
let det = P.panelSeo(dc, { contenido: 'c-bor', vistaCliente: true, formulario: true });
ok(!det.includes('SECRETO') && !det.includes('data-form-contenido'), 'un borrador: el cliente no ve el texto ni puede responder');
det = P.panelSeo(dc, { contenido: 'c-rev', vistaCliente: true, formulario: true, nombre: 'Marilia' });
ok(det.includes('data-accion="aprobar"') && det.includes('data-accion="cambios"') && det.includes('value="Marilia"'), 'en revisión: aprobar, pedir cambios, con su nombre recordado');
ok(det.includes('<p>Párrafo uno.</p>') && det.includes('&lt;b&gt;dos&lt;/b&gt;') && det.includes('pidió cambios') && det.includes('v1'), 'texto en párrafos y escapado; la conversación dice qué pidió y en qué versión');
det = P.panelSeo(dc, { contenido: 'c-apr', vistaCliente: true, formulario: true });
ok(det.includes('Aprobado por Marilia') && !det.includes('data-accion="aprobar"') && det.includes('data-accion="comentario"'), 'aprobada: dice quién aprobó; solo se puede comentar');
ok(!P.panelSeo(dc, { contenido: 'c-rev', vistaCliente: false }).includes('data-form-contenido'), 'en la app no sale el formulario del cliente');

console.log('\nFase 2: la revisión del cliente, ejecutada (fetch simulado)');
{
  const pub = (await import('../api/seo-publico.js')).default;
  const antes = globalThis.fetch;
  const estado = { enlace: { id: 'e1', proyecto_id: 'p1', revocado_at: null }, pieza: { id: '11111111-1111-4111-8111-111111111111', proyecto_id: 'p1', estado: 'en_revision', titulo: 'Arriendo', version: 2, creado_por: 'user_ase' }, recientes: 0, patchVacio: false };
  const escrito = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), m = init.method || 'GET';
    const res = (b, st = 200) => new Response(b === null ? null : JSON.stringify(b), { status: st });
    if (m !== 'GET') escrito.push(m + ' ' + u.replace('https://sb.test/rest/v1', '') + ' ' + (init.body || '').slice(0, 160));
    if (u.includes('/seo_enlaces?token=')) return res(estado.enlace ? [estado.enlace] : []);
    if (u.includes('/seo_contenidos?id=') && m === 'GET') return res(u.includes('id=eq.' + estado.pieza.id) && u.includes('proyecto_id=eq.p1') ? [estado.pieza] : []);
    if (u.includes('/seo_contenido_comentarios?') && m === 'GET') return res(Array(estado.recientes).fill({ id: 1 }));
    if (u.includes('/seo_contenidos?id=') && m === 'PATCH') return res(estado.patchVacio ? [] : [{ id: 'x' }]);
    if (u.includes('/seo_proyectos?')) return res([{ id: 'p1', user_id: 'user_dueno', nombre: 'Certain' }]);
    if (u.includes('/team_members?')) return res([{ member_user_id: 'user_ase', member_name: 'Laura', member_email: 'laura@x.com' }]);
    if (u.includes('/users?')) return res([{ name: 'Dueña', email: 'duena@x.com' }]);
    if (u.includes('/push_subs?')) return res([]);
    return res([]);
  };
  try {
    const enviar = (b) => pub(new Request('https://app.acuarius.app/api/seo-publico', { method: 'POST', body: JSON.stringify({ t: 'a'.repeat(32), contenido_id: estado.pieza.id, ...b }) }));
    let r = await enviar({ accion: 'aprobar', nombre: '' });
    ok(r.status === 400 && /tu nombre/.test((await r.json()).error), 'sin nombre no se acepta');
    r = await enviar({ accion: 'cambios', nombre: 'Marilia', texto: '' });
    ok(r.status === 400, 'pedir cambios exige decir cuáles');
    escrito.length = 0;
    r = await enviar({ accion: 'aprobar', nombre: 'Marilia' });
    const d = await r.json();
    ok(r.status === 200 && d.estado === 'aprobado', 'aprobar: queda aprobada', d);
    ok(escrito.some(x => x.startsWith('PATCH /seo_contenidos?id=') && x.includes('estado=eq.en_revision') && x.includes('"aprobado_por":"Marilia"')), 'el cambio de estado solo aplica si sigue en revisión, y guarda quién aprobó');
    ok(escrito.some(x => x.startsWith('POST /seo_contenido_comentarios') && x.includes('"accion":"aprobado"') && x.includes('"version":2')), 'queda en la conversación, con la versión aprobada');
    estado.patchVacio = true;
    r = await enviar({ accion: 'cambios', nombre: 'Otra', texto: 'x' });
    ok(r.status === 409, 'si otra persona ya respondió, no se pisa su decisión');
    estado.patchVacio = false;
    estado.pieza.estado = 'borrador';
    r = await enviar({ accion: 'comentario', nombre: 'Marilia', texto: 'hola' });
    ok(r.status === 409, 'no se comenta un borrador');
    estado.pieza.estado = 'aprobado'; estado.recientes = 20;
    r = await enviar({ accion: 'comentario', nombre: 'Marilia', texto: 'hola' });
    ok(r.status === 429, 'tope de mensajes por hora');
    estado.recientes = 0;
    r = await pub(new Request('https://app.acuarius.app/api/seo-publico', { method: 'POST', body: JSON.stringify({ t: 'a'.repeat(32), contenido_id: '22222222-2222-4222-8222-222222222222', accion: 'comentario', nombre: 'X', texto: 'y' }) }));
    ok(r.status === 404, 'una pieza de otro proyecto no se puede tocar con este enlace');
    estado.enlace.revocado_at = '2026-10-01';
    r = await enviar({ accion: 'comentario', nombre: 'Marilia', texto: 'hola' });
    ok(r.status === 410, 'con el enlace desactivado no se puede responder');
  } catch (e) { ok(false, 'la revisión del cliente no revienta al ejecutarse', e.stack); }
  finally { globalThis.fetch = antes; }
}

console.log('\nFase 2: lo que carga el enlace (fetch simulado)');
{
  const { cargarProyecto } = await import('../api/_seo-datos.js');
  const antes = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    const res = (b) => new Response(JSON.stringify(b), { status: 200 });
    if (u.includes('/seo_proyectos?')) return res([{ id: 'p', user_id: 'u', client_id: 'c', nombre: 'N', dominio: 'd.com', correo_cliente: 'cli@x.com' }]);
    if (u.includes('/seo_contenidos?')) return res([{ id: 'b', estado: 'borrador', cuerpo: 'SECRETO', enlace_doc: 'https://doc' }, { id: 'r', estado: 'en_revision', cuerpo: 'Visible' }]);
    if (u.includes('/seo_contenido_comentarios?')) return res([{ contenido_id: 'b', texto: 'interno' }, { contenido_id: 'r', texto: 'ok' }]);
    return res([]);
  };
  try {
    const d = await cargarProyecto('p', { publico: true });
    ok(!d.proyecto.correo_cliente && !d.proyecto.user_id, 'el enlace no expone el correo del cliente ni la cuenta');
    ok(d.contenidos.find(c => c.id === 'b').cuerpo === null && d.contenidos.find(c => c.id === 'b').enlace_doc === null && d.contenidos.find(c => c.id === 'r').cuerpo === 'Visible', 'un borrador viaja sin texto ni documento');
    ok(d.comentarios.length === 1 && d.comentarios[0].contenido_id === 'r', 'ni los comentarios de un borrador');
    const a = await cargarProyecto('p');
    ok(a.contenidos.find(c => c.id === 'b').cuerpo === 'SECRETO' && a.proyecto.correo_cliente === 'cli@x.com', 'la app sí ve todo');
  } catch (e) { ok(false, 'cargarProyecto no revienta', e.message); }
  finally { globalThis.fetch = antes; }
}

console.log('\nLo demás');
const cron = (await import('../api/cron-seo.js')).default;
ok((await cron(new Request('https://x/api/cron-seo'))).status === 401, 'el cron sin secreto → 401');
await import('../api/seo-proyectos.js');
ok(true, 'api/seo-proyectos.js carga sin errores');
const vj = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
ok(vj.rewrites.some(r => r.source === '/seo/:token' && r.destination === '/seo.html'), 'ruta /seo/:token');
ok(vj.crons.some(c => c.path === '/api/cron-seo'), 'cron-seo programado');
ok(/'cron-seo': 30/.test(readFileSync(new URL('../api/_latido.js', import.meta.url), 'utf8')), '…y vigilado por su latido');
const idx = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
ok(idx.includes('<script src="/seo-proyecto.js"></script>') && idx.indexOf('/app.js"') < idx.indexOf('/seo-proyecto.js"'), 'la pantalla nueva carga DESPUÉS de app.js (reemplaza a la vieja)');
ok(/if\(id==='seo-project' && typeof seoAbrir==='function'\) seoAbrir\(\);/.test(readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')), 'toda ruta a seo-project pasa por la pantalla nueva');

console.log(mal ? `\n${mal} fallo(s)` : '\nTodo en verde');
process.exit(mal ? 1 : 0);

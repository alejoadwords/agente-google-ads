// Servidor MCP (api/mcp.js) ejecutado de verdad contra Supabase.
//
// Lo que tiene que quedar demostrado: que habla el protocolo (initialize,
// tools/list, tools/call, notificaciones, lotes) y que NO abre ninguna puerta
// que la API no abra — misma llave, mismos permisos, mismas reglas.
//
// Clerk se simula; la base es la real. Cuenta propia `user_prueba_mcp_<hora>`,
// que se borra al final.
//
//   node pruebas/mcp.mjs <carpeta con .env>
import fs from 'fs';
for (const l of fs.readFileSync(process.argv[2] + '/.env', 'utf8').split('\n')) { const i = l.indexOf('='); if (i > 0) process.env[l.slice(0, i)] = l.slice(i + 1); }
let mal = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) mal++; };

const T = Date.now();
const DUENO = 'user_prueba_mcp_' + T;
const SB = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };

const fetchReal = globalThis.fetch;
const J = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.resend.com')) return J({ id: 'simulado' });
  if (u.startsWith('https://api.clerk.com/v1/users/')) {
    const id = decodeURIComponent(u.split('/users/')[1].split(/[/?]/)[0]);
    return id === DUENO ? J({ id, public_metadata: { plan: 'pro' }, email_addresses: [{ email_address: `mcp${T}@prueba.test` }] }) : J({}, 404);
  }
  return fetchReal(url, init);
};

const mcp = (await import('../api/mcp.js?v=' + T)).default;
const { generarLlave } = await import('../api/_api-llaves.js');
const sbGet = p => fetchReal(`${SB}/rest/v1/${p}`, { headers: sbH }).then(r => r.json());
const sbPost = (p, b) => fetchReal(`${SB}/rest/v1/${p}`, { method: 'POST', headers: { ...sbH, Prefer: 'return=representation' }, body: JSON.stringify(b) }).then(async r => { if (!r.ok) throw new Error(p + ': ' + await r.text()); return r.json(); });
const sbDel = p => fetchReal(`${SB}/rest/v1/${p}`, { method: 'DELETE', headers: sbH });

async function rpc(llave, cuerpo, { metodo = 'POST', origen } = {}) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (llave) headers.Authorization = 'Bearer ' + llave;
  if (origen) headers.Origin = origen;
  const r = await mcp(new Request('https://app.acuarius.app/api/mcp', { method: metodo, headers, body: cuerpo ? JSON.stringify(cuerpo) : undefined }));
  const t = await r.text();
  return { s: r.status, d: t ? JSON.parse(t) : null };
}
const llamar = (llave, name, args, id = 1) => rpc(llave, { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
const textoDe = r => r.d?.result?.content?.[0]?.text || '';

async function llaveCon(nombre, permisos) {
  const g = await generarLlave();
  await sbPost('api_llaves', { user_id: DUENO, nombre, prefijo: g.prefijo, hash: g.hash, permisos, creada_por: DUENO });
  return g.llave;
}

try {
  const [proceso] = await sbPost('pipelines', { user_id: DUENO, client_id: null, name: 'Venta MCP', is_default: true, position: 1 });
  await sbPost('pipeline_stages', [
    { user_id: DUENO, pipeline_id: proceso.id, key: 'nuevo', label: 'Nuevo', color: '#6B7280', position: 1 },
    { user_id: DUENO, pipeline_id: proceso.id, key: 'ganado', label: 'Ganado', color: '#10B981', position: 2 },
  ]);
  await sbPost('close_reasons', [{ user_id: DUENO, kind: 'won', label: 'Compró', position: 1 }]);
  const LECTORA = await llaveCon('Agente lector', ['leads:leer']);
  const GESTORA = await llaveCon('Agente gestor', ['leads:leer', 'leads:escribir', 'leads:etapa']);

  console.log('Puerta');
  let r = await rpc(null, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  ok(r.s === 401 && r.d?.error?.code === -32001, 'sin llave: 401 con error JSON-RPC');
  r = await rpc(LECTORA, { jsonrpc: '2.0', id: 1, method: 'ping' }, { origen: 'https://pagina-cualquiera.com' });
  ok(r.s === 403, 'desde un navegador ajeno: 403');
  r = await rpc(LECTORA, null, { metodo: 'GET' });
  ok(r.s === 405, 'GET (sin flujo SSE): 405');

  console.log('Protocolo');
  r = await rpc(LECTORA, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'prueba', version: '1' } } });
  ok(r.s === 200 && r.d?.result?.protocolVersion === '2025-06-18' && r.d.result.capabilities?.tools && r.d.result.serverInfo?.name === 'acuarius', 'initialize: acepta la versión pedida y declara herramientas');
  ok(/ver_procesos/.test(r.d?.result?.instructions || ''), 'initialize: trae instrucciones para el modelo');
  r = await rpc(LECTORA, { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
  ok(r.d?.result?.protocolVersion === '2025-11-25', 'versión desconocida: ofrece la más nueva que soporta');
  r = await rpc(LECTORA, { jsonrpc: '2.0', method: 'notifications/initialized' });
  ok(r.s === 202 && r.d === null, 'notificación: 202 sin cuerpo');
  r = await rpc(LECTORA, { jsonrpc: '2.0', id: 3, method: 'nada/de/nada' });
  ok(r.d?.error?.code === -32601, 'método desconocido: -32601');
  r = await rpc(LECTORA, [{ jsonrpc: '2.0', id: 4, method: 'ping' }, { jsonrpc: '2.0', id: 5, method: 'ping' }]);
  ok(Array.isArray(r.d) && r.d.length === 2 && r.d[1].id === 5, 'lote: responde a cada mensaje');

  console.log('Herramientas según la llave');
  r = await rpc(LECTORA, { jsonrpc: '2.0', id: 6, method: 'tools/list' });
  const nombres = (r.d?.result?.tools || []).map(t => t.name);
  ok(nombres.includes('buscar_prospectos') && nombres.includes('quien_soy'), 'la lectora ve las de lectura');
  ok(!nombres.includes('mover_etapa') && !nombres.includes('crear_prospecto') && !nombres.includes('buscar_tareas'), 'y NO las que su llave no permite');
  ok((r.d?.result?.tools || []).every(t => t.inputSchema?.type === 'object' && t.annotations?.destructiveHint === false), 'esquemas válidos y ninguna destructiva');
  r = await rpc(GESTORA, { jsonrpc: '2.0', id: 7, method: 'tools/list' });
  ok((r.d?.result?.tools || []).some(t => t.name === 'mover_etapa'), 'la gestora sí ve mover_etapa');
  ok(!(r.d?.result?.tools || []).some(t => /campa|automat|correo|whatsapp|enviar/i.test(t.name)), 'ninguna herramienta de Marketing ni de envío');

  console.log('Usar herramientas');
  r = await llamar(LECTORA, 'ver_procesos', {});
  ok(!r.d?.result?.isError && JSON.parse(textoDe(r)).procesos?.[0]?.etapas?.length === 2, 'ver_procesos devuelve el proceso y sus etapas');
  r = await llamar(LECTORA, 'crear_prospecto', { name: 'Por la puerta de atrás' });
  ok(r.d?.result?.isError === true && /sin_permiso/.test(textoDe(r)), 'una herramienta oculta llamada igual: la API la niega (sin_permiso)');
  r = await llamar(GESTORA, 'crear_prospecto', { name: 'Carlos MCP', email: `carlos${T}@prueba.test` });
  const lead = JSON.parse(textoDe(r)).lead;
  ok(!r.d?.result?.isError && lead?.stage === 'nuevo', 'crear_prospecto crea');
  r = await llamar(GESTORA, 'mover_etapa', { id: lead.id, etapa: 'Ganado' });
  ok(r.d?.result?.isError === true && /falta_motivo/.test(textoDe(r)) && /Compró/.test(textoDe(r)), 'ganar sin motivo: error legible con los motivos válidos');
  r = await llamar(GESTORA, 'mover_etapa', { id: lead.id, etapa: 'Ganado', motivo: 'Compró', valor: 1000 });
  ok(!r.d?.result?.isError && JSON.parse(textoDe(r)).lead?.stage === 'ganado', 'con motivo: gana');
  const hist = await sbGet(`lead_activities?lead_id=eq.${lead.id}&type=eq.stage_change&select=content,metadata`);
  ok(hist.some(h => h.content === 'Ganada · Compró' && h.metadata?.actor === 'Agente gestor'), 'y queda firmado en el historial con el nombre de la llave');
  r = await llamar(GESTORA, 'ver_prospecto', { id: '00000000-0000-0000-0000-000000000000' });
  ok(r.d?.result?.isError === true && /no_encontrado/.test(textoDe(r)), 'id inexistente: error, no un resultado vacío');
  r = await rpc(GESTORA, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'borrar_todo', arguments: {} } });
  ok(r.d?.error?.code === -32602, 'herramienta que no existe: -32602');
} catch (e) {
  console.error(e);
  mal++;
} finally {
  const ids = (await sbGet(`leads?user_id=eq.${DUENO}&select=id`)).map(l => l.id).join(',');
  if (ids) {
    await sbDel(`lead_activities?lead_id=in.(${ids})`);
    await sbDel(`activities?lead_id=in.(${ids})`);
    await sbDel(`automation_jobs?lead_id=in.(${ids})`);
  }
  await sbDel(`leads?user_id=eq.${DUENO}`);
  await sbDel(`pipeline_stages?user_id=eq.${DUENO}`);
  await sbDel(`pipelines?user_id=eq.${DUENO}`);
  await sbDel(`close_reasons?user_id=eq.${DUENO}`);
  await sbDel(`lead_tags?user_id=eq.${DUENO}`);
  const llaves = (await sbGet(`api_llaves?user_id=eq.${DUENO}&select=id`)).map(l => l.id).join(',');
  if (llaves) {
    await sbDel(`api_uso?llave_id=in.(${llaves})`);
    await sbDel(`api_idempotencia?llave_id=in.(${llaves})`);
  }
  await sbDel(`api_registro?user_id=eq.${DUENO}`);
  await sbDel(`api_llaves?user_id=eq.${DUENO}`);
  ok((await sbGet(`leads?user_id=eq.${DUENO}&select=id`)).length === 0 && (await sbGet(`api_llaves?user_id=eq.${DUENO}&select=id`)).length === 0, 'limpieza: no queda nada de la prueba');
}
console.log(mal ? `\n${mal} fallos` : '\nTodo bien');
process.exit(mal ? 1 : 0);

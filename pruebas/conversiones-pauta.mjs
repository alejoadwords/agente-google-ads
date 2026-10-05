// Ventas a Meta y a Google (api/_conversiones.js): node pruebas/conversiones-pauta.mjs
//
// Las redes y la base se simulan: aquí se comprueba QUÉ se le manda a cada una
// y qué queda escrito en la fila según lo que contesten. El disparador que
// llena la cola se probó contra la base real (sql/conversiones_pauta.sql).
process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';
process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'dev';

let mal = 0;
const ok = (c, t, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + t + (!c && extra ? ' → ' + extra : '')); if (!c) mal++; };

// ── Red y base simuladas ────────────────────────────────────────────────────
let respuestaMeta = () => ({ status: 200, body: { events_received: 1 } });
let respuestaGoogle = () => ({ status: 200, body: { results: [{}] } });
const enviadoA = { meta: [], google: [], metaUrl: [], datasetsPedidos: [], canalParcheado: [] };
let canalWA = null;
let calificadoYa = false;   // ¿la base dice que otra etapa ya salió como calificado?
const accionesCreadas = [];   // la fila de channel_connections que devuelve la base simulada
const parches = [];
const J = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://graph.facebook.com/') && /\/dataset$/.test(u)) {
    enviadoA.datasetsPedidos.push(u); return J({ id: 'DS_WABA' });
  }
  if (u.startsWith('https://graph.facebook.com/')) {
    enviadoA.meta.push(JSON.parse(init.body)); enviadoA.metaUrl.push(u);
    const r = respuestaMeta(); return J(r.body, r.status);
  }
  if (u.includes('googleads.googleapis.com')) {
    if (u.includes('googleAds:search')) return J({ results: [] });
    if (u.includes('conversionActions:mutate')) {
      accionesCreadas.push(JSON.parse(init.body).operations[0].create);
      return J({ results: [{ resourceName: 'customers/1234567890/conversionActions/' + (100 + accionesCreadas.length) }] });
    }
    enviadoA.google.push(JSON.parse(init.body));
    const r = respuestaGoogle(); return J(r.body, r.status);
  }
  if (u.startsWith('https://base.falsa/rest/v1/conversiones_pauta') && (init.method || 'GET') === 'GET') {
    return J(calificadoYa ? [{ id: 'otra' }] : []);
  }
  if (u.startsWith('https://base.falsa/rest/v1/conversiones_pauta') && init.method === 'PATCH') {
    parches.push(JSON.parse(init.body)); return new Response(null, { status: 204 });
  }
  if (u.startsWith('https://base.falsa/rest/v1/platform_connections')) return new Response(null, { status: 204 });
  if (u.startsWith('https://base.falsa/rest/v1/chat_conversations')) return J(canalWA ? [{ connection_id: canalWA.id }] : []);
  if (u.startsWith('https://base.falsa/rest/v1/channel_connections')) {
    if (init.method === 'PATCH') { enviadoA.canalParcheado.push(JSON.parse(init.body)); return new Response(null, { status: 204 }); }
    return J(canalWA ? [canalWA] : []);
  }
  return J([]);
};

const m = await import('../api/_conversiones.js');
const hace = (dias) => new Date(Date.now() - dias * 86400000).toISOString();
const fila = (red, extra = {}) => ({ id: 'f1', red, evento: 'Purchase', event_id: 'acu-x-1', ocurrio_at: hace(1), intentos: 0, ...extra });
const lead = (extra = {}) => ({
  id: '11111111-2222-3333-4444-555555555555', user_id: 'u', client_id: null, name: 'Ana María Pérez',
  email: 'Ana.Perez@Gmail.com', phone: '300 123 4567', value: 2500000, stage: 'ganado',
  close_currency: null, created_at: hace(20), custom_fields: {}, ...extra,
});
const META = { id: 'm1', platform: 'meta_capi', client_id: null, account_id: '987654321', access_token: 'tok', extra_data: { activo: true } };
const GOOGLE = { id: 'g1', platform: 'google_ads', client_id: null, account_id: '123-456-7890', access_token: 'gt',
  token_expires_at: new Date(Date.now() + 3600000).toISOString(), extra_data: { login_customer_id: null, conversiones: { activo: true, accion: 'customers/1234567890/conversionActions/9' } } };

console.log('Datos como los piden las redes');
ok(m.telefonoE164('300 123 4567') === '573001234567', 'un celular colombiano sin indicativo se completa con 57');
ok(m.telefonoE164('+1 (415) 555-0100') === '14155550100', 'un número con indicativo se respeta');
ok(m.telefonoE164('6015551234') === '6015551234', 'un fijo sin indicativo NO se inventa país');
ok(m.correoNormal('Ana.Perez@Gmail.com', true) === 'anaperez@gmail.com' && m.correoNormal('Ana.Perez@Gmail.com') === 'ana.perez@gmail.com',
   'Google quita los puntos de Gmail; Meta solo pasa a minúsculas');
ok(m.correoNormal('no-es-correo') === null, 'un correo inválido no se manda');

console.log('Las llaves de cada lead');
let k = m.llavesDelLead(lead({ custom_fields: { 'Clic de anuncio': 'CTWA123', 'Plataforma': 'Meta', 'ID de anuncio': '555' } }));
ok(k.ctwa === 'CTWA123' && !k.fbclid, 'un clic de Meta que vino con anuncio de WhatsApp es un clic a WhatsApp');
k = m.llavesDelLead(lead({ custom_fields: { 'Clic de anuncio': 'FB123', 'Plataforma': 'Meta' } }));
ok(k.fbclid === 'FB123' && !k.ctwa, 'sin anuncio de WhatsApp es un clic web');
k = m.llavesDelLead(lead({ custom_fields: { 'Clic de anuncio': 'WB1', 'Tipo de clic': 'wbraid', 'Plataforma': 'Google' } }));
ok(k.wbraid === 'WB1' && !k.gclid, 'el tipo guardado manda: un wbraid no se sube como gclid');

console.log('Meta');
enviadoA.meta.length = 0; parches.length = 0;
let c = await m.procesarFila(fila('meta'), { lead: lead({ custom_fields: { 'ID de lead de Meta': '525645896321548' } }), conexiones: [META], moneda: 'COP' });
const ev = enviadoA.meta[0]?.data?.[0] || {};
ok(c.estado === 'enviado', 'se envía y queda «enviado»', JSON.stringify(c));
ok(ev.event_name === 'Purchase' && ev.custom_data.value === 2500000 && ev.custom_data.currency === 'COP', 'como compra, con su valor y moneda');
ok(ev.action_source === 'system_generated' && ev.custom_data.lead_event_source === 'Acuarius' && ev.custom_data.event_source === 'crm',
   'con el formato de la API de conversiones para CRM');
ok(ev.user_data.lead_id === '525645896321548', 'la mejor llave: el id del lead del formulario');
ok(ev.user_data.ph[0].length === 64 && !JSON.stringify(ev).includes('3001234567') && !JSON.stringify(ev).includes('gmail'),
   'teléfono y correo van cifrados; en claro no sale nada');
ok(ev.event_id === 'acu-x-1', 'el mismo event_id en cada reintento: Meta no la cuenta dos veces');
ok(c.llave.startsWith('lead de Meta'), 'la fila dice con qué se identificó · ' + c.llave);

console.log('Clic a WhatsApp');
const deWhatsapp = lead({ created_at: hace(1), custom_fields: { 'Clic de anuncio': 'CTWA9', 'Plataforma': 'Meta', 'ID de anuncio': '1', 'Tipo de clic': 'ctwa_clid' } });
canalWA = { id: 'cc1', waba_id: 'WABA1', access_token: 'token-wa', conversiones_dataset: null, client_id: null };
enviadoA.meta.length = 0; enviadoA.metaUrl.length = 0;
c = await m.procesarFila(fila('meta'), { lead: deWhatsapp, conexiones: [META], moneda: 'COP' });
const ew = enviadoA.meta[0]?.data?.[0] || {};
ok(c.estado === 'enviado' && ew.action_source === 'business_messaging' && ew.messaging_channel === 'whatsapp',
   'con el WhatsApp conectado, la venta va como mensajería de negocio', JSON.stringify(c));
ok(ew.user_data.ctwa_clid === 'CTWA9' && ew.user_data.whatsapp_business_account_id === 'WABA1',
   'con el ctwa_clid Y el id de la cuenta de WhatsApp Business, que Meta exige juntos');
ok(enviadoA.datasetsPedidos[0]?.includes('/WABA1/dataset') && enviadoA.metaUrl[0]?.includes('/DS_WABA/events'),
   'al conjunto de datos de la cuenta de WhatsApp (pedido a Meta), no al pixel');
ok(enviadoA.meta[0]?.access_token === 'token-wa', 'con el token de WhatsApp, que es el que tiene permiso sobre esa cuenta');
ok(enviadoA.canalParcheado[0]?.conversiones_dataset === 'DS_WABA', 'el conjunto se guarda en la conexión para no pedirlo en cada venta');
ok(ew.custom_data.value === 2500000 && ew.custom_data.currency === 'COP' && !ew.custom_data.event_source,
   'la compra lleva valor y moneda, sin los campos de CRM');

canalWA = null;
enviadoA.meta.length = 0; enviadoA.metaUrl.length = 0;
c = await m.procesarFila(fila('meta'), { lead: deWhatsapp, conexiones: [META], moneda: 'COP' });
const ex = enviadoA.meta[0]?.data?.[0] || {};
ok(c.estado === 'enviado' && ex.action_source === 'system_generated' && !ex.user_data.ctwa_clid && enviadoA.metaUrl[0]?.includes('/987654321/'),
   'sin el WhatsApp conectado: al pixel como CRM, sin un ctwa_clid que Meta rechazaría');
ok(/no está conectado a Acuarius/.test(c.motivo || ''), 'y la fila lo dice, para que no parezca la llave buena · ' + c.motivo);

enviadoA.meta.length = 0;
c = await m.procesarFila(fila('meta', { ocurrio_at: hace(8) }), { lead: lead(), conexiones: [META], moneda: 'COP' });
ok(c.estado === 'vencido' && !enviadoA.meta.length, 'una venta de hace 8 días no se intenta: Meta solo acepta 7');

c = await m.procesarFila(fila('meta'), { lead: lead({ phone: null, email: null, name: null }), conexiones: [META], moneda: 'COP' });
ok(c.estado === 'sin_datos', 'sin teléfono, correo ni anuncio: «sin datos», no un envío inútil');

respuestaMeta = () => ({ status: 400, body: { error: { code: 190, message: 'Invalid OAuth access token' } } });
c = await m.procesarFila(fila('meta'), { lead: lead(), conexiones: [META], moneda: 'COP' });
ok(c.estado === 'rechazado' && /token de Meta no es válido/.test(c.motivo), 'token vencido: rechazado, y dice qué hacer');

respuestaMeta = () => ({ status: 500, body: { error: { message: 'temporal', is_transient: true } } });
c = await m.procesarFila(fila('meta'), { lead: lead(), conexiones: [META], moneda: 'COP' });
ok(c.estado === 'pendiente' && c.intentos === 1 && Date.parse(c.proximo_at) > Date.now() + 9 * 60000, 'un fallo temporal se reintenta en 10 minutos');
c = await m.procesarFila(fila('meta', { intentos: m.MAX_INTENTOS - 1 }), { lead: lead(), conexiones: [META], moneda: 'COP' });
ok(c.estado === 'rechazado', 'tras ' + m.MAX_INTENTOS + ' intentos deja de reintentar y lo dice');
respuestaMeta = () => ({ status: 200, body: { events_received: 1 } });

c = await m.procesarFila(fila('meta'), { lead: lead({ stage: 'perdido' }), conexiones: [META], moneda: 'COP' });
ok(c.estado === 'cancelado', 'si el lead dejó de estar ganado antes de salir, no se reporta');
c = await m.procesarFila(fila('meta'), { lead: lead(), conexiones: [{ ...META, extra_data: { activo: false } }], moneda: 'COP' });
ok(c.estado === 'cancelado', 'si apagaron el envío, lo que quedaba en cola no sale');

enviadoA.meta.length = 0;
c = await m.procesarFila(fila('meta', { evento: 'Lead', event_id: 'acu-lead-1' }), { lead: lead({ stage: 'nuevo', custom_fields: { 'ID de lead de Meta': '1' } }), conexiones: [META], moneda: 'COP' });
const el = enviadoA.meta[0]?.data?.[0] || {};
ok(c.estado === 'enviado' && el.event_name === 'Lead' && el.custom_data.value === undefined && c.valor === undefined,
   'el «Lead» de entrada sale aunque el lead no esté ganado, y SIN el valor del negocio');

console.log('Clic a WhatsApp: los eventos estándar de Meta');
{
  canalWA = { id: 'cc1', waba_id: 'WABA1', access_token: 'token-wa', conversiones_dataset: 'DS_WABA', client_id: null };
  enviadoA.meta.length = 0;
  await m.procesarFila(fila('meta', { evento: 'Lead', event_id: 'acu-lead-w' }), { lead: { ...deWhatsapp, stage: 'nuevo' }, conexiones: [META], moneda: 'COP' });
  ok(enviadoA.meta[0]?.data?.[0]?.event_name === 'LeadSubmitted', 'la entrada sale como «LeadSubmitted», no como «Lead»');
  enviadoA.meta.length = 0; calificadoYa = false;
  c = await m.procesarFila(fila('meta', { id: 'f-q1', evento: 'Cita de inmueble', etapa: 'cita', valor_etapa: 30000 }), { lead: { ...deWhatsapp, stage: 'cita' }, conexiones: [META], moneda: 'COP' });
  const q = enviadoA.meta[0]?.data?.[0] || {};
  ok(c.estado === 'enviado' && q.event_name === 'QualifiedLead' && q.custom_data.value === 30000 && q.user_data.ctwa_clid === 'CTWA9',
     'la etapa marcada sale como «QualifiedLead» con el valor de la etapa', JSON.stringify(c));
  calificadoYa = true; enviadoA.meta.length = 0;
  c = await m.procesarFila(fila('meta', { id: 'f-q2', evento: 'Propuesta', etapa: 'propuesta' }), { lead: { ...deWhatsapp, stage: 'propuesta' }, conexiones: [META], moneda: 'COP' });
  ok(c.estado === 'cancelado' && !enviadoA.meta.length && /un calificado por clic/.test(c.motivo), 'una segunda etapa no suma otro calificado: Meta cuenta uno por clic');
  calificadoYa = false; enviadoA.meta.length = 0;
  c = await m.procesarFila(fila('meta'), { lead: { ...deWhatsapp, created_at: hace(9) }, conexiones: [META], moneda: 'COP' });
  const v = enviadoA.meta[0]?.data?.[0] || {};
  ok(c.estado === 'enviado' && v.action_source === 'system_generated' && v.event_name === 'Purchase' && !v.user_data.ctwa_clid && /más de 7 días/.test(c.motivo),
     'pasados 7 días del clic sale por el pixel, sin el ctwa_clid, y la fila lo dice');
  canalWA = null;
}

console.log('Etapas del embudo');
{
  enviadoA.meta.length = 0;
  const filaEt = fila('meta', { evento: 'Cita de inmueble', etapa: 'cita', valor_etapa: 50000, event_id: 'acu-et-1-cita' });
  c = await m.procesarFila(filaEt, { lead: lead({ stage: 'cita', custom_fields: { 'ID de lead de Meta': '9' } }), conexiones: [META], moneda: 'COP' });
  const e1 = enviadoA.meta[0]?.data?.[0] || {};
  ok(c.estado === 'enviado' && e1.event_name === 'Cita de inmueble', 'una etapa sale aunque el lead NO esté ganado, con el nombre de la etapa', JSON.stringify(c));
  ok(e1.custom_data.value === 50000 && e1.custom_data.currency === 'COP' && c.valor === 50000,
     'con el valor de la ETAPA, no el del negocio (2.500.000)');
  ok(e1.action_source === 'system_generated' && e1.custom_data.event_source === 'crm' && e1.user_data.lead_id === '9',
     'como evento de CRM con el lead de Meta: es lo que pide Conversion Leads');
  enviadoA.meta.length = 0;
  await m.procesarFila(fila('meta', { evento: 'Calificado', etapa: 'calificado', valor_etapa: null }), { lead: lead({ stage: 'calificado' }), conexiones: [META], moneda: 'COP' });
  ok(enviadoA.meta[0]?.data?.[0]?.custom_data.value === undefined, 'una etapa sin valor va sin valor (no con 0 ni con el del negocio)');

  enviadoA.google.length = 0; accionesCreadas.length = 0;
  const G2 = JSON.parse(JSON.stringify(GOOGLE));
  const filaG = fila('google', { evento: 'Cita de inmueble', etapa: 'cita', valor_etapa: 50000 });
  const leadG = lead({ stage: 'cita', custom_fields: { 'Clic de anuncio': 'GCL9', 'Plataforma': 'Google' } });
  c = await m.procesarFila(filaG, { lead: leadG, conexiones: [G2], moneda: 'COP' });
  const cr = accionesCreadas[0] || {};
  ok(c.estado === 'enviado' && cr.name === 'Acuarius — Cita de inmueble' && cr.category === 'QUALIFIED_LEAD', 'Google: la etapa tiene su propia acción de conversión', JSON.stringify(c));
  ok(cr.primaryForGoal === false, 'creada SECUNDARIA: no cambia las pujas sin que el cliente lo decida');
  const gv2 = enviadoA.google.at(-1)?.conversions?.[0] || {};
  ok(gv2.conversionAction.endsWith('/101') && gv2.conversionValue === 50000 && gv2.gclid === 'GCL9', 'y la etapa sube a ESA acción, con el valor de la etapa');
  ok(G2.extra_data.conversiones.etapas?.cita?.endsWith('/101'), 'la acción queda guardada en la conexión');
  await m.procesarFila(filaG, { lead: leadG, conexiones: [G2], moneda: 'COP' });
  ok(accionesCreadas.length === 1, 'la segunda vez se reutiliza: no se crea otra acción');
  c = await m.procesarFila(fila('google'), { lead: lead({ custom_fields: { 'Clic de anuncio': 'G1', 'Plataforma': 'Google' } }), conexiones: [G2], moneda: 'COP' });
  ok(enviadoA.google.at(-1).conversions[0].conversionAction.endsWith('/9'), 'la venta sigue yendo a «Venta en Acuarius»');
}

console.log('Cada cliente con su conjunto de datos');
const deCliente = { ...META, id: 'm2', client_id: 'cli_1', account_id: '111' };
ok(m.conexionPara([META, deCliente], 'meta', lead({ client_id: 'cli_1' })).account_id === '111', 'el lead de un cliente va al conjunto de ESE cliente');
ok(m.conexionPara([META, deCliente], 'meta', lead({ client_id: 'cli_2' })).account_id === '987654321', 'otro cliente sin el suyo usa el de la cuenta');
ok(m.conexionPara([deCliente], 'meta', lead({ client_id: 'cli_2' })) === null, 'y nunca el de otro cliente');

console.log('Google');
enviadoA.google.length = 0;
c = await m.procesarFila(fila('google'), { lead: lead({ custom_fields: { 'Clic de anuncio': 'GCL1', 'Plataforma': 'Google' } }), conexiones: [GOOGLE], moneda: 'COP' });
const gv = enviadoA.google[0]?.conversions?.[0] || {};
ok(c.estado === 'enviado', 'se sube y queda «enviado»', JSON.stringify(c));
ok(gv.gclid === 'GCL1' && gv.conversionAction.endsWith('/9') && gv.conversionValue === 2500000 && gv.currencyCode === 'COP',
   'al clic, a la acción «Venta en Acuarius», con valor y moneda');
ok(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\+00:00$/.test(gv.conversionDateTime || ''), 'con la fecha en el único formato que acepta Google');
ok(gv.userIdentifiers?.length === 2 && gv.userIdentifiers.every(x => (x.hashedEmail || x.hashedPhoneNumber || '').length === 64),
   'más correo y teléfono cifrados (conversiones mejoradas)');
ok(enviadoA.google[0]?.partialFailure === true, 'con partialFailure, para leer el motivo de un rechazo');

enviadoA.google.length = 0;
c = await m.procesarFila(fila('google'), { lead: lead(), conexiones: [GOOGLE], moneda: 'COP' });
ok(c.estado === 'enviado' && !enviadoA.google[0].conversions[0].gclid && c.llave === 'correo + teléfono', 'sin clic, solo con correo y teléfono');

respuestaGoogle = () => ({ status: 200, body: { partialFailureError: { message: 'The click is older than the lookback window' } } });
c = await m.procesarFila(fila('google'), { lead: lead({ custom_fields: { 'Clic de anuncio': 'G', 'Plataforma': 'Google' } }), conexiones: [GOOGLE], moneda: 'COP' });
ok(c.estado === 'rechazado' && /lookback/.test(c.motivo), 'un rechazo parcial de Google NO se da por enviado: se dice el motivo');
respuestaGoogle = () => ({ status: 200, body: { results: [{}] } });

c = await m.procesarFila(fila('google'), { lead: lead({ close_currency: 'usd' }), conexiones: [GOOGLE], moneda: 'COP' });
ok(enviadoA.google.at(-1).conversions[0].currencyCode === 'USD', 'la moneda del cierre manda sobre la de la cuenta');

console.log(mal ? `\n${mal} fallo(s)\n` : '\nTodo en orden\n');
process.exit(mal ? 1 : 0);

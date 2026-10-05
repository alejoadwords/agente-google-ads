// El agente de voz: node pruebas/agente-voz.mjs
//
// Se ejecuta el código real (api/_agente-voz.js, api/agente-voz.js y
// voz-agente/acuarius.js) contra un Supabase y un Clerk de mentira. Sin audio
// ni LiveKit: eso se prueba llamando. Lo que aquí se vigila es lo que cuesta
// plata o datos si se rompe: el cobro por minuto o fracción, que una llamada
// no se cobre dos veces, que una prueba no se cobre ni llene el CRM, que sin
// minutos no se deje a nadie colgado y que el worker y el servidor hablen de
// las mismas herramientas.

process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';
process.env.CLERK_SECRET_KEY = 'clerk';
process.env.AGENTE_VOZ_BETA = 'dueno';
process.env.AGENTE_VOZ_SECRETO = 'secreto-del-worker';
process.env.LIVEKIT_URL = 'wss://acuarius.livekit.cloud';
process.env.LIVEKIT_API_KEY = 'APIclave';
process.env.LIVEKIT_API_SECRET = 'secreto-livekit';
delete process.env.ANTHROPIC_API_KEY;   // sin resumen con IA en la prueba

import fs from 'node:fs';
let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + extra : '')); if (!c) mal++; };
const resp = (d, s = 200) => new Response(d === null ? null : JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });

// ── Sesión de Clerk de mentira ──────────────────────────────────────────────
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const par = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const JWKS = { keys: [{ ...(await crypto.subtle.exportKey('jwk', par.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }] };
async function tokenDe(sub) {
  const cab = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
  const cuerpo = b64u(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 3600 }));
  const firma = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', par.privateKey, new TextEncoder().encode(`${cab}.${cuerpo}`));
  return `${cab}.${cuerpo}.${b64u(new Uint8Array(firma))}`;
}

// ── Supabase de mentira ─────────────────────────────────────────────────────
let T, idn = 0, consultasCatalogo = [];
function cumple(fila, k, v) {
  if (['select', 'order', 'limit', 'offset', 'on_conflict', 'or'].includes(k)) return true;
  if (!(k in fila)) return v === 'is.null';
  const x = fila[k];
  if (v === 'is.null') return x == null;
  if (v.startsWith('eq.')) return String(x) === v.slice(3);
  if (v.startsWith('like.')) return x != null && new RegExp('^' + v.slice(5).split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(String(x));
  return true;
}
const filtrar = (tabla, sp) => (T[tabla] || []).filter(f => [...sp.entries()].every(([k, v]) => cumple(f, k, v)));
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const metodo = init.method || 'GET';
  if (u.pathname.includes('jwks.json')) return resp(JWKS);
  if (u.hostname === 'api.clerk.com') return resp({ id: 'dueno', public_metadata: { plan: 'pro' } });
  if (u.hostname !== 'base.falsa') return resp({});
  const tabla = u.pathname.replace('/rest/v1/', '');
  if (tabla === 'client_properties') consultasCatalogo.push(decodeURIComponent(u.search));
  if (tabla === 'rpc/minutos_voz_saldo') {
    const b = JSON.parse(init.body);
    return resp(T.minutos_voz.filter(m => m.user_id === b.p_user).reduce((a, m) => a + m.cantidad, 0));
  }
  if (tabla.startsWith('rpc/')) return resp(null);
  const filas = filtrar(tabla, u.searchParams);
  if (metodo === 'PATCH') {
    const c = JSON.parse(init.body); filas.forEach(f => Object.assign(f, c));
    return /return=representation/.test((init.headers || {}).Prefer || '') ? resp(filas) : resp(null, 204);
  }
  if (metodo === 'POST') {
    const nuevas = [].concat(JSON.parse(init.body));
    if (tabla === 'minutos_voz') {
      const hechas = [];
      for (const n of nuevas) {
        if (T.minutos_voz.some(m => m.motivo === n.motivo && m.referencia === n.referencia)) continue;
        T.minutos_voz.push(n); hechas.push(n);
      }
      return resp(hechas, 201);
    }
    const conId = nuevas.map(n => ({ id: n.id || 'id' + (++idn), created_at: new Date().toISOString(), ...n }));
    (T[tabla] = T[tabla] || []).push(...conId);
    return resp(conId, 201);
  }
  return resp(filas);
};

function mundo() {
  idn = 0;
  T = {
    agentes_voz: [{ id: 'A1', user_id: 'dueno', client_id: null, nombre: 'Lucía', negocio: 'Inmobiliaria Sol', proposito: 'recepcion',
      saludo: null, instrucciones: 'Atendemos de lunes a sábado.', voz: 'voz-123', tono: 'tu', numero: '576015551234', desvio: '573001112233', activo: true }],
    llamadas_voz: [], minutos_voz: [{ user_id: 'dueno', cantidad: 300, motivo: 'plan', referencia: 'oct' }],
    leads: [{ id: 'L1', user_id: 'dueno', client_id: null, name: 'Ana Pérez', email: 'ana@x.co', phone: '+57 310 444 5566', stage: 'nuevo', deleted_at: null }],
    lead_activities: [], team_members: [], user_profiles: [], client_properties: [],
  };
}

const lib = await import('../api/_agente-voz.js');
const h = (await import('../api/agente-voz.js')).default;
const worker = (cuerpo, secreto = 'secreto-del-worker') => h(new Request('https://app.acuarius.app/api/agente-voz', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-agente-voz': secreto }, body: JSON.stringify(cuerpo) }));
const cliente = async (metodo, cuerpo, sub = 'dueno') => h(new Request('https://app.acuarius.app/api/agente-voz', {
  method: metodo, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await tokenDe(sub) }, body: cuerpo ? JSON.stringify(cuerpo) : undefined }));

console.log('\nMinuto o fracción');
{
  const { minutosCobrados } = lib;
  ok(minutosCobrados(0) === 0, 'una llamada que no conectó no se cobra');
  ok(minutosCobrados(1) === 1 && minutosCobrados(60) === 1, 'de 1 a 60 segundos es un minuto');
  ok(minutosCobrados(61) === 2 && minutosCobrados(130) === 3, '61 s son dos minutos y 2:10 son tres');
  ok(minutosCobrados(-5) === 0 && minutosCobrados('x') === 0, 'basura no cobra');
  ok(lib.costoEstimado(130) === Math.round(130 / 60 * lib.COSTO_MINUTO_USD * 10000) / 10000, 'el costo se mide con los segundos reales, no con el redondeo');
  ok(JSON.stringify(lib.PLANES_VOZ.map(p => [p.usd, p.minutos])) === JSON.stringify([[79, 300], [199, 900], [399, 2000]]) && lib.USD_MINUTO_EXTRA === 0.25,
    'los precios son los aprobados el 03-10-2026: 79/300, 199/900, 399/2.000 y 0,25 el minuto extra');
}

console.log('\nLas instrucciones');
{
  const base = { agente: { nombre: 'Lucía', proposito: 'calificacion', instrucciones: 'Somos de Barranquilla.' }, negocio: 'Inmobiliaria Sol' };
  let t = lib.instruccionesDeVoz(base);
  ok(/Lucía/.test(t) && /Inmobiliaria Sol/.test(t) && /Somos de Barranquilla/.test(t), 'dice quién es, de qué negocio y lo que el negocio indicó');
  ok(/Turnos MUY cortos/.test(t) && /cállate y escúchala/.test(t) && /colgar/.test(t), 'las reglas de voz (brevedad, ceder el turno, colgar) van dentro');
  ok(/Solo condiciones, precios/.test(t) && /sin tarjeta/.test(t), 'y la regla de no afirmar nada que no esté escrito (la prueba del 05-10 se inventó «sin tarjeta»)');
  ok(/despídete en ESE turno/.test(t) && /Nunca cuelgues sin despedirte/.test(t) && /gracias por preguntar/.test(t), 'se despide en voz alta antes de colgar, una sola vez, y fuera las frases de manual');
  ok(/NUNCA uses «vos»/.test(t) && /no a lo que no dijo/.test(t) && /con quién tengo el gusto/.test(t), 'tutea sin «vos», responde solo a lo que le dijeron y pide el nombre con naturalidad');
  ok(/NUNCA digas «sin tarjeta»/.test(t), 'y tiene prohibido en concreto «sin tarjeta» (lo inventó en las dos pruebas)');
  ok(/no lo pidas/.test(t) && /guardar_datos/.test(t), 'a quien no está en el CRM le pide el nombre y no el teléfono');
  t = lib.instruccionesDeVoz({ ...base, conocido: 'Ana Pérez, ana@x.co', hayCatalogo: true });
  ok(/YA ESTÁ EN EL CRM: Ana Pérez/.test(t) && /buscar_inmuebles/.test(t), 'a un conocido no le pide datos, y con catálogo sabe que puede buscar');
  ok(!t.includes('`'), 'sin comillas invertidas');
  ok(lib.saludoDe({ nombre: 'Lucía' }, 'Inmobiliaria Sol', 'Ana') === 'Hola Ana, te habla Lucía de Inmobiliaria Sol. ¿En qué te ayudo?', 'saluda por el nombre a quien ya conoce');
  ok(lib.saludoDe({ nombre: 'Lucía', saludo: 'Buenas, {{nombre}}, gracias por llamar' }, 'X', null) === 'Buenas, gracias por llamar', 'un saludo propio sin nombre conocido no deja «, ,»');
  ok(lib.saludoDe({ nombre: 'Lucía', saludo: 'Buenas, {{nombre}}, gracias por llamar' }, 'X', 'Ana') === 'Buenas, Ana, gracias por llamar', 'y con nombre lo pone');
  const citas = lib.bloqueCitasVoz({ hoy: '2026-10-05', servicios: [{ clave: 'ab12cd34', nombre: 'Visita', minutos: 30, huecos: [{ dia: '2026-10-06', horas: ['09:00', '10:00'] }] }] });
  ok(/agendar_cita/.test(citas) && /ab12cd34/.test(citas) && /2026-10-06 a las 09:00, 10:00/.test(citas) && !/\[RESERVA/.test(citas), 'las citas se ofrecen con la herramienta, sin el bloque [RESERVA] del chat');
}

console.log('\nEl token de LiveKit');
{
  const tok = await lib.tokenLiveKit({ identidad: 'cliente-1', sala: 'prueba-1', agente: 'acuarius-voz', metadata: '{"agente_id":"A1"}' });
  const [c, p, f] = tok.split('.');
  const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode('secreto-livekit'), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const valida = await crypto.subtle.verify('HMAC', clave, Buffer.from(f, 'base64url'), new TextEncoder().encode(c + '.' + p));
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  ok(valida, 'la firma HS256 verifica con el secreto de LiveKit');
  ok(claims.iss === 'APIclave' && claims.video.room === 'prueba-1' && claims.video.roomJoin === true && claims.exp > claims.nbf, 'da acceso solo a esa sala y vence');
  ok(claims.roomConfig?.agents?.[0]?.agentName === 'acuarius-voz' && claims.roomConfig.agents[0].metadata === '{"agente_id":"A1"}', 'despacha nuestro worker con el agente en la metadata');
}

console.log('\nEl worker: configuración de la llamada');
{
  mundo();
  let r = await worker({ accion: 'config', sala: 's1', numero: '+57 601 555 1234' }, 'otro');
  ok(r.status === 401, 'sin el secreto del worker no responde nada');
  r = await worker({ accion: 'config', sala: 's1', numero: '+57 601 555 1234', telefono: '+573104445566', direccion: 'entrante' });
  let d = await r.json();
  ok(r.status === 200 && d.llamada_id && d.agente.voz === 'voz-123', 'encuentra el agente por el número marcado', JSON.stringify(d).slice(0, 200));
  ok(/YA ESTÁ EN EL CRM: Ana Pérez/.test(d.instrucciones) && d.saludo.startsWith('Hola Ana'), 'reconoce a quien llama por su teléfono y lo saluda por su nombre');
  ok(T.llamadas_voz[0]?.lead_id === 'L1' && (T.llamadas_voz[0].estado ?? 'en_curso') === 'en_curso', 'abre la llamada colgada de su lead');
  ok(d.max_segundos === 1800, 'con 300 minutos de saldo, la llamada tiene el tope de 30 minutos', d.max_segundos);
  ok(d.desvio === '573001112233', 'sabe a qué número pasar al asesor');
  ok(d.agente.velocidad === 1.1, 'sin velocidad configurada, habla a 1.1 (a 1.0 sonaba lenta)', d.agente.velocidad);
  r = await worker({ accion: 'config', sala: 's1', numero: '6015551234', telefono: '+573104445566' });
  ok(T.llamadas_voz.length === 1, 'si el worker se reinicia a mitad, reusa la misma llamada');

  r = await worker({ accion: 'config', sala: 's2', numero: '+57 601 999 0000' });
  d = await r.json();
  ok(r.status === 404 && d.colgar, 'un número sin agente se cuelga con el motivo');
  T.agentes_voz[0].activo = false;
  r = await worker({ accion: 'config', sala: 's3', numero: '576015551234' });
  ok(r.status === 409, 'un agente apagado no contesta');
  T.agentes_voz[0].activo = true;
  process.env.AGENTE_VOZ_BETA = 'otra';
  r = await worker({ accion: 'config', sala: 's3', numero: '576015551234' });
  ok(r.status === 409, 'una cuenta fuera de la beta no contesta aunque tenga agente');
  process.env.AGENTE_VOZ_BETA = 'dueno';

  T.minutos_voz.push({ user_id: 'dueno', cantidad: -300, motivo: 'ajuste', referencia: 'fin' });
  r = await worker({ accion: 'config', sala: 's4', numero: '576015551234', telefono: '+573209998877' });
  d = await r.json();
  ok(d.sin_saldo && d.desvio === '573001112233' && /asesor/.test(d.mensaje), 'sin minutos no se cuelga a nadie: la llamada pasa al asesor');
  ok(T.llamadas_voz.find(l => l.sala === 's4')?.estado === 'sin_saldo', 'y queda en el historial por qué');

  r = await worker({ accion: 'config', sala: 'prueba-x', agente_id: 'A1', direccion: 'prueba' });
  d = await r.json();
  ok(r.status === 200 && d.max_segundos === 300 && !d.sin_saldo, 'una prueba desde el navegador funciona sin saldo y dura como mucho 5 minutos');
}

console.log('\nEl worker: herramientas');
{
  mundo();
  await worker({ accion: 'config', sala: 'p1', agente_id: 'A1', direccion: 'prueba' });
  const prueba = T.llamadas_voz[0].id;
  let d = await (await worker({ accion: 'herramienta', llamada_id: prueba, nombre: 'guardar_datos', args: { nombre: 'Juan' } })).json();
  ok(d.prueba && T.leads.length === 1, 'en una prueba, guardar datos no crea leads de ensayo en el CRM');
  d = await (await worker({ accion: 'herramienta', llamada_id: prueba, nombre: 'pasar_a_asesor', args: {} })).json();
  ok(d.desvio === '573001112233' && !T.lead_activities.length, 'pasar a un asesor devuelve el número, y en prueba no escribe notas');
  // Lo que pasó con Certain el 05-10-2026: «3 millones» como texto dejaba la
  // consulta en «lte.NaN» y Aura decía que no había nada.
  T.client_properties = [
    { user_id: 'dueno', client_id: null, codigo: 'X1', operacion: 'Arriendo', tipo: 'Apartamento', ciudad: 'Barranquilla', barrio: 'Alto Prado', habitaciones: 3, precio: 2800000, precio_arriendo: 2800000 },
    { user_id: 'dueno', client_id: null, codigo: 'X2', operacion: 'Arriendo', tipo: 'Apartamento', ciudad: 'Barranquilla', barrio: 'Villa Santos', habitaciones: 3, precio: 2600000, precio_arriendo: 2600000 },
    { user_id: 'dueno', client_id: null, codigo: 'X3', operacion: 'Arriendo', tipo: 'Apartamento', ciudad: 'Barranquilla', barrio: 'Rebolo', habitaciones: 3, precio: 900000, precio_arriendo: 900000 },
  ];
  consultasCatalogo = [];
  d = await (await worker({ accion: 'herramienta', llamada_id: prueba, nombre: 'buscar_inmuebles',
    args: { operacion: 'arriendo', tipo: 'apartamento', ciudad: 'Barranquilla', zona: 'el norte', presupuesto: '3 millones', habitaciones: 3 } })).json();
  const busqueda = consultasCatalogo.find(q => q.includes('habitaciones=gte.')) || '';
  ok(/precio_arriendo\.lte\.3450000/.test(busqueda) && !/NaN/.test(busqueda), 'el presupuesto «3 millones» llega como número (con el 15 % de margen), nunca NaN', busqueda);
  ok(/habitaciones=gte\.3/.test(busqueda) && /tipo=eq\.Apartamento/.test(busqueda), 'filtra por habitaciones y por tipo con la mayúscula del catálogo', busqueda);
  ok(/barrio=in\.\(.*Alto Prado.*\)/.test(busqueda) && !/Rebolo/.test(busqueda.match(/barrio=in\.\(([^)]*)\)/)?.[1] || ''), '«el norte» se traduce a los barrios del norte del catálogo', busqueda);
  ok(d.ok && d.total > 0 && /X1|X2/.test(d.texto), 'y devuelve los inmuebles', JSON.stringify(d));
  const { buscarPistas } = await import('../api/agente-voz.js');
  const p0 = buscarPistas({ presupuesto: 'hasta dos', habitaciones: 'tres', tipo: '' });
  ok(p0.presupuesto === undefined && p0.habitaciones === undefined && p0.tipo === undefined, 'lo que no se entiende se deja sin filtrar, no se convierte en basura', JSON.stringify(p0));
  ok(buscarPistas({ presupuesto: 2500000 }).presupuesto === 2500000, 'un presupuesto que ya es número pasa tal cual');

  const r = await worker({ accion: 'herramienta', llamada_id: prueba, nombre: 'borrar_todo', args: {} });
  ok(r.status === 400, 'una herramienta que no existe se rechaza');
}

console.log('\nEl worker: fin de la llamada');
{
  mundo();
  await worker({ accion: 'config', sala: 'f1', numero: '576015551234', telefono: '+573104445566' });
  const id = T.llamadas_voz[0].id;
  const transcripcion = [{ rol: 'agente', texto: 'Hola Ana' }, { rol: 'cliente', texto: 'Hola, quiero ver el apartamento' }, { rol: 'x', texto: '' }];
  let d = await (await worker({ accion: 'fin', llamada_id: id, segundos: 130, transcripcion, estado: 'terminada' })).json();
  const ll = T.llamadas_voz[0];
  ok(d.minutos === 3 && ll.minutos_cobrados === 3 && ll.segundos === 130, 'una llamada de 2:10 se cobra como 3 minutos');
  ok(T.minutos_voz.filter(m => m.motivo === 'llamada').length === 1 && T.minutos_voz.find(m => m.motivo === 'llamada').cantidad === -3, 'el libro descuenta 3 minutos');
  ok(ll.transcripcion.length === 2 && ll.transcripcion[1].rol === 'cliente', 'guarda la transcripción limpia');
  ok(T.lead_activities.some(a => a.lead_id === 'L1' && a.type === 'llamada' && /2:10/.test(a.content)), 'queda en la ficha del lead con su duración');
  d = await (await worker({ accion: 'fin', llamada_id: id, segundos: 130, transcripcion })).json();
  ok(d.repetida && T.minutos_voz.filter(m => m.motivo === 'llamada').length === 1 && T.lead_activities.length === 1, 'si el fin llega dos veces, no se cobra ni se anota dos veces');

  await worker({ accion: 'config', sala: 'prueba-f', agente_id: 'A1', direccion: 'prueba' });
  const idp = T.llamadas_voz.find(l => l.sala === 'prueba-f').id;
  d = await (await worker({ accion: 'fin', llamada_id: idp, segundos: 200, transcripcion })).json();
  ok(d.minutos === 0 && T.minutos_voz.filter(m => m.motivo === 'llamada').length === 1, 'una llamada de prueba no se cobra');
}

console.log('\nLa pantalla del cliente');
{
  mundo();
  let d = await (await cliente('GET')).json();
  ok(d.activo && d.saldo === 300 && d.agentes.length === 1 && d.planes.length === 3 && d.livekit === true, 've su saldo, su agente y los planes');
  process.env.AGENTE_VOZ_BETA = 'otra';
  d = await (await cliente('GET')).json();
  ok(d.activo === false && !d.agentes, 'fuera de la beta no ve nada');
  process.env.AGENTE_VOZ_BETA = 'dueno';
  let r = await cliente('POST', { accion: 'guardar', agente: { nombre: 'Lucía' } });
  ok(r.status === 400 && /negocio/.test((await r.json()).error), 'sin el nombre del negocio no se guarda');
  r = await cliente('POST', { accion: 'guardar', agente: { nombre: 'Lucía', negocio: 'Sol', desvio: '123' } });
  ok(r.status === 400, 'un número de asesor inválido no se guarda');
  r = await cliente('POST', { accion: 'guardar', agente: { nombre: 'Pedro', negocio: 'Sol', proposito: 'raro', desvio: '300 111 2233' } });
  d = await r.json();
  ok(r.status === 200 && d.agente.user_id === 'dueno' && d.agente.proposito === 'recepcion' && d.agente.desvio === '573001112233', 'crea el agente con lo validado', JSON.stringify(d));
  r = await cliente('POST', { accion: 'guardar', agente: { nombre: 'Rápida', negocio: 'Sol', velocidad: '1.2' } });
  ok((await r.json()).agente.velocidad === 1.2, 'guarda la velocidad elegida');
  r = await cliente('POST', { accion: 'guardar', agente: { nombre: 'Loca', negocio: 'Sol', velocidad: '3' } });
  ok((await r.json()).agente.velocidad === 1.1, 'una velocidad fuera de las tres opciones vuelve a la natural');
  r = await cliente('POST', { accion: 'guardar', agente: { id: 'A1', nombre: 'Lucía 2', negocio: 'Sol' } });
  ok(r.status === 200 && T.agentes_voz[0].nombre === 'Lucía 2', 'edita el suyo');
  T.agentes_voz.push({ id: 'AJ', user_id: 'otra', client_id: null, nombre: 'Ajeno', negocio: 'X', activo: true });
  r = await cliente('POST', { accion: 'guardar', agente: { id: 'AJ', nombre: 'Robado', negocio: 'X' } });
  ok(r.status === 404 && T.agentes_voz.find(a => a.id === 'AJ').nombre === 'Ajeno', 'no puede editar el agente de otra cuenta');
  r = await cliente('POST', { accion: 'probar', agente_id: 'AJ' });
  ok(r.status === 404, 'ni probar el de otra cuenta');
  r = await cliente('POST', { accion: 'probar', agente_id: 'A1' });
  d = await r.json();
  ok(r.status === 200 && d.url === 'wss://acuarius.livekit.cloud' && d.token.split('.').length === 3 && d.sala.startsWith('prueba-'), 'probar da la sala y el token para hablar desde el navegador');
}

console.log('\nEl worker por dentro (voz-agente/acuarius.js)');
{
  const w = await import('../voz-agente/acuarius.js');
  let x = w.datosDeLaLlamada({ atributos: { 'sip.trunkPhoneNumber': '+576015551234', 'sip.phoneNumber': '+573104445566' }, metadata: '' });
  ok(x.direccion === 'entrante' && x.numero === '+576015551234' && x.telefono === '+573104445566' && !x.agente_id, 'una llamada de teléfono trae el número marcado y el de quien llama');
  x = w.datosDeLaLlamada({ atributos: {}, metadata: '{"agente_id":"A1","direccion":"prueba"}' });
  ok(x.direccion === 'prueba' && x.agente_id === 'A1', 'una prueba trae el agente en la metadata');
  ok(w.datosDeLaLlamada({ metadata: '{roto' }).direccion === 'entrante', 'una metadata rota no tumba la llamada');
  const t = w.transcripcionDe([{ role: 'system', textContent: 'x' }, { role: 'assistant', textContent: ' Hola ' }, { role: 'user', textContent: '' }, { role: 'user', textContent: 'Sí' }]);
  ok(JSON.stringify(t) === JSON.stringify([{ rol: 'agente', texto: 'Hola' }, { rol: 'cliente', texto: 'Sí' }]), 'la transcripción queda como la guarda Acuarius, sin el sistema ni vacíos');
  ok(w.duracion(1000, 131400) === 130 && w.duracion(5000, 1000) === 0, 'la duración se redondea y nunca es negativa');

  let pedidos = 0;
  const c500 = w.crearCliente({ secreto: 's', fetchFn: async () => { pedidos++; return resp({ error: 'caído' }, 503); } });
  let fallo = null;
  try { await c500.fin('L', {}); } catch (e) { fallo = e; }
  ok(fallo && pedidos === 4, 'el fin se reintenta 4 veces ante un 5xx (si se pierde, la llamada no se cobra)', pedidos);
  pedidos = 0;
  const c404 = w.crearCliente({ secreto: 's', fetchFn: async () => { pedidos++; return resp({ error: 'no hay agente', colgar: true }, 404); } });
  const r = await c404.config({});
  ok(pedidos === 1 && r.status === 404 && r.colgar, 'un 4xx es una respuesta: no se reintenta');
  let cab = null;
  await w.crearCliente({ secreto: 'mio', fetchFn: async (u, i) => { cab = i.headers['x-agente-voz']; return resp({}); } }).config({});
  ok(cab === 'mio', 'el worker se identifica con su secreto');
}

console.log('\nCaché de instrucciones y latencias (voz-agente/acuarius.js)');
{
  const w = await import('../voz-agente/acuarius.js');
  let p = w.conCache({ model: 'x', system: 'Eres Lucía', messages: [{ role: 'user', content: 'hola' }] });
  ok(Array.isArray(p.system) && p.system[0].text === 'Eres Lucía' && p.system[0].cache_control?.type === 'ephemeral' && p.messages.length === 1,
    'las instrucciones van marcadas para caché y la conversación queda igual', JSON.stringify(p));
  p = w.conCache({ system: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] });
  ok(!p.system[0].cache_control && p.system[1].cache_control, 'con varias partes, la marca va en la última (cubre todo lo anterior)');
  const original = { system: 'x' }; w.conCache(original);
  ok(original.system === 'x', 'no toca el objeto original');
  ok(w.conCache({ messages: [] }).system === undefined, 'sin instrucciones no inventa nada');
  const lat = w.resumenLatencias([
    { type: 'eou_metrics', endOfUtteranceDelayMs: 400 }, { type: 'eou_metrics', endOfUtteranceDelayMs: 600 },
    { type: 'llm_metrics', ttftMs: 500 }, { type: 'llm_metrics', ttftMs: 700 },
    { type: 'tts_metrics', ttfbMs: 200 }, { type: 'tts_metrics', ttfbMs: -1 }, { type: 'stt_metrics' },
  ]);
  ok(lat.eou_ms.promedio === 500 && lat.llm_ttft_ms.promedio === 600 && lat.tts_ttfb_ms.n === 1 && lat.respuesta_ms === 1300,
    'resume cuánto tarda cada parte y lo que siente la persona (1,3 s)', JSON.stringify(lat));
  ok(w.resumenLatencias([]).respuesta_ms === null, 'sin métricas no inventa un tiempo');
}

console.log('\nUna sola definición de herramientas');
{
  const nombres = lib.HERRAMIENTAS.map(h => h.nombre);
  ok(nombres.includes('colgar') && lib.HERRAMIENTAS_SERVIDOR.join() === nombres.filter(n => n !== 'colgar').join(), 'colgar es del worker; las demás, del servidor', nombres.join());
  const api = fs.readFileSync(new URL('../api/agente-voz.js', import.meta.url), 'utf8');
  ok(lib.HERRAMIENTAS_SERVIDOR.every(n => api.includes(`case '${n}':`)), 'el servidor tiene un caso para cada una');
  ok(lib.HERRAMIENTAS.every(h => h.parametros?.type === 'object' && h.descripcion.length > 20), 'todas con esquema y descripción');
  const src = fs.readFileSync(new URL('../voz-agente/agente.js', import.meta.url), 'utf8');
  ok(/herramientas\(cfg\.herramientas,/.test(src) && !/llm\.tool\(\{\s*description: '/.test(src), 'el worker las toma de la configuración y no tiene copia propia');
  const busca = lib.HERRAMIENTAS.find(h => h.nombre === 'buscar_inmuebles').descripcion;
  ok(/MISMO TURNO/.test(busca) && /sin anunciarla/.test(busca), 'buscar_inmuebles se llama en el mismo turno y sin anunciarla (dijo «déjame buscar» tres veces sin buscar)');
  ok(/relleno/.test(lib.HERRAMIENTAS.find(h => h.nombre === 'guardar_datos').descripcion), 'guardar_datos prohíbe datos de relleno («Por confirmar»)');
  mundo();
  const d = await (await worker({ accion: 'config', sala: 'cfg-h', agente_id: 'A1', direccion: 'prueba' })).json();
  ok(Array.isArray(d.herramientas) && d.herramientas.some(h => h.nombre === 'buscar_inmuebles' && h.parametros), 'la configuración de cada llamada trae las definiciones');
}

console.log('\nEnsayo en texto');
{
  const { ensayar } = await import('../api/agente-voz.js');
  const llamadas = [];
  // Un Claude de mentira: al pedir arriendo en el norte, busca; con el
  // resultado, responde; al despedirse, cuelga.
  const llm = async (c) => {
    llamadas.push(c);
    const ultimo = c.messages[c.messages.length - 1];
    if (Array.isArray(ultimo.content) && ultimo.content[0]?.type === 'tool_result') {
      return { content: [{ type: 'text', text: 'Tengo uno en Alto Prado por dos millones ochocientos.' }] };
    }
    if (/norte/.test(ultimo.content)) return { content: [{ type: 'tool_use', id: 't1', name: 'buscar_inmuebles', input: { operacion: 'arriendo', zona: 'el norte' } }] };
    if (/gracias/.test(ultimo.content)) return { content: [{ type: 'text', text: 'Con gusto, chao.' }, { type: 'tool_use', id: 't2', name: 'colgar', input: {} }] };
    return { content: [{ type: 'text', text: '¿Con quién tengo el gusto?' }] };
  };
  const ejecutados = [];
  const ejecutar = async (b) => { ejecutados.push(b); return new Response(JSON.stringify({ ok: true, texto: 'X1 · Alto Prado · $2.800.000' })); };
  const config = async () => new Response(JSON.stringify({ llamada_id: 'L9', saludo: 'Hola, te habla Aura', instrucciones: 'SISTEMA', herramientas: lib.HERRAMIENTAS }));
  const r = await ensayar({ agenteId: 'A1', turnos: ['Hola', 'Busco arriendo en el norte', 'Muchas gracias', 'esto ya no se dice'], ejecutar, llm, config });
  ok(r.traza[0].texto === 'Hola, te habla Aura' && llamadas[0].system === 'SISTEMA' && llamadas[0].tools.length === lib.HERRAMIENTAS.length,
    'usa el saludo, las instrucciones y las herramientas de la configuración real');
  ok(llamadas[0].model === 'claude-haiku-4-5' && llamadas[0].max_tokens === 160, 'y el mismo modelo y tope que el teléfono');
  ok(ejecutados.length === 1 && ejecutados[0].nombre === 'buscar_inmuebles' && ejecutados[0].llamada_id === 'L9', 'ejecuta la búsqueda por el mismo camino que una llamada', JSON.stringify(ejecutados));
  ok(r.traza.some(t => t.herramienta === 'buscar_inmuebles' && /Alto Prado/.test(t.resultado)) && r.traza.some(t => /Alto Prado por dos millones/.test(t.texto || '')),
    'la traza muestra la herramienta, su resultado y la respuesta con él');
  ok(r.colgo && !r.traza.some(t => t.texto === 'esto ya no se dice'), 'al colgar se detiene', JSON.stringify(r.traza.slice(-2)));
}

console.log(mal ? `\n${mal} fallos` : '\nTodo en verde');
process.exit(mal ? 1 : 0);

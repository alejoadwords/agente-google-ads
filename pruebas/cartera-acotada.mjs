// La cartera de un miembro acotado: node pruebas/cartera-acotada.mjs
//
// `/api/profile?type=agency_clients` cambia al id del DUEÑO para devolver su
// cartera —correcto, el miembro trabaja bajo su cuenta— pero la devolvía
// entera. Karen y Laura, acotadas al cliente «Acuarius», recibían los 11
// clientes de la agencia con su industria, su presupuesto y sus notas.
//
// Y arreglar solo eso habría sido peor: al guardar, el endpoint escribía la
// lista que le mandara el navegador. Con la cartera ya filtrada, la primera
// vez que Karen editara la ficha de Acuarius, su navegador habría guardado
// una lista de UN cliente y borrado los otros diez.
//
// Se lee el fichero y se ejecutan las dos ramas con un `fetch` de mentira.

import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../api/profile.js', import.meta.url), 'utf8');

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

const CARTERA = [
  { id: 'ac_forest', name: 'Forest Living', presupuesto: '5M' },
  { id: 'ac_ilumin', name: 'Iluminata' },
  { id: 'ac_acuarius', name: 'Acuarius', notas: 'la nuestra' },
];

// El handler verifica el JWT de Clerk de verdad, así que se le da uno de
// verdad: se genera una pareja de claves, se firma el token y el JWKS se sirve
// desde el mismo `fetch` de mentira. Saltarse la verificación habría dejado sin
// probar que el endpoint sabe de QUIÉN es la petición, que es medio arreglo.
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const par = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify']);
const JWKS = { keys: [{ ...(await crypto.subtle.exportKey('jwk', par.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }] };
async function tokenDe(sub) {
  const cabecera = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
  const cuerpo = b64u(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 3600 }));
  const firma = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', par.privateKey, new TextEncoder().encode(`${cabecera}.${cuerpo}`));
  return `${cabecera}.${cuerpo}.${b64u(new Uint8Array(firma))}`;
}
const JWT = await tokenDe('miembro_karen');

// Base de mentira: responde como PostgREST a las tres consultas que hace el
// endpoint, y apunta lo que se intenta ESCRIBIR.
function montar({ clienteDelMiembro }) {
  const escrito = [];
  globalThis.fetch = async (url, opciones = {}) => {
    const u = String(url);
    const json = (x) => ({ ok: true, status: 200, json: async () => x, text: async () => JSON.stringify(x) });
    if (u.includes('jwks.json')) return json(JWKS);
    if (u.includes('/team_members')) {
      return json([{ owner_user_id: 'dueño', client_id: clienteDelMiembro }]);
    }
    if (u.includes('/user_profiles') && (opciones.method || 'GET') === 'GET') {
      return json([{ profile_data: { clients: CARTERA } }]);
    }
    if (u.includes('/user_profiles')) {
      escrito.push(JSON.parse(opciones.body).profile_data.clients);
      return json({});
    }
    if (u.includes('/users')) return json([{ id: 'dueño' }]);
    return json({});
  };
  return { escrito };
}

// El handler real, con sus dependencias de entorno puestas.
process.env.SUPABASE_URL = 'https://sb';
process.env.SUPABASE_SERVICE_KEY = 'k';
const { default: handler } = await import('../api/profile.js?' + Date.now());

const pedir = async (metodo, cuerpo) => {
  const req = new Request('https://x/api/profile?type=agency_clients', {
    method: metodo,
    headers: { Authorization: 'Bearer ' + JWT, 'Content-Type': 'application/json' },
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
  });
  return handler(req);
};

console.log('\nEl miembro acotado solo ve SU cliente\n');
{
  const { } = montar({ clienteDelMiembro: 'ac_acuarius' });
  const r = await pedir('GET');
  const d = await r.json().catch(() => ({}));
  if (r.status !== 200) {
    chk('el GET responde 200', false, 'HTTP ' + r.status + ' ' + JSON.stringify(d).slice(0, 120));
  } else {
    chk('recibe un solo cliente', (d.data || []).length === 1, JSON.stringify(d.data));
    chk('y es el suyo', d.data?.[0]?.id === 'ac_acuarius');
    const texto = JSON.stringify(d);
    chk('no se le filtra ningún otro nombre',
        !texto.includes('Forest Living') && !texto.includes('Iluminata'), texto.slice(0, 120));
  }
}

console.log('\nEl dueño sigue viendo la cartera entera\n');
{
  montar({ clienteDelMiembro: null });
  const r = await pedir('GET');
  const d = await r.json().catch(() => ({}));
  chk('recibe los tres', (d.data || []).length === 3, JSON.stringify((d.data || []).length));
}

console.log('\nGuardar desde el miembro NO borra el resto de la cartera\n');
{
  const { escrito } = montar({ clienteDelMiembro: 'ac_acuarius' });
  // Su navegador solo tiene el suyo, porque es lo único que se le dio.
  const r = await pedir('POST', { data: [{ id: 'ac_acuarius', name: 'Acuarius', notas: 'editado por Karen' }] });
  chk('el guardado responde bien', r.status === 200, 'HTTP ' + r.status);
  const guardado = escrito[0] || [];
  chk('se guardan los TRES, no uno', guardado.length === 3, JSON.stringify(guardado.map(c => c.id)));
  chk('los otros dos quedan intactos',
      guardado.find(c => c.id === 'ac_forest')?.presupuesto === '5M' &&
      guardado.find(c => c.id === 'ac_ilumin')?.name === 'Iluminata');
  chk('y lo suyo sí se actualiza',
      guardado.find(c => c.id === 'ac_acuarius')?.notas === 'editado por Karen');
}

console.log('\nUn miembro acotado no puede colar clientes nuevos ni quitar los de otros\n');
{
  const { escrito } = montar({ clienteDelMiembro: 'ac_acuarius' });
  await pedir('POST', { data: [
    { id: 'ac_acuarius', name: 'Acuarius' },
    { id: 'ac_colado', name: 'Cliente inventado' },   // no es suyo
  ] });
  const ids = (escrito[0] || []).map(c => c.id);
  chk('el colado no entra', !ids.includes('ac_colado'), JSON.stringify(ids));
  chk('y siguen estando los tres de siempre', ids.length === 3, JSON.stringify(ids));
}

console.log('\nSi no se puede leer lo que había, no se escribe a ciegas\n');
{
  montar({ clienteDelMiembro: 'ac_acuarius' });
  const antes = globalThis.fetch;
  globalThis.fetch = async (url, o = {}) => {
    if (String(url).includes('/user_profiles') && (o.method || 'GET') === 'GET') {
      return { ok: false, status: 500, json: async () => ({}), text: async () => 'boom' };
    }
    return antes(url, o);
  };
  const r = await pedir('POST', { data: [{ id: 'ac_acuarius', name: 'Acuarius' }] });
  // Guardar sin saber qué había es justo lo que vacía una cartera.
  chk('se niega a guardar en vez de arriesgarse', r.status === 503, 'HTTP ' + r.status);
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);

// Permisos de Google Ads: node pruebas/google-ads.mjs
//
// `login-customer-id` se mandaba SIEMPRE con nuestro administrador. Eso vale
// para las cuentas que cuelgan de él —la de pruebas, con la que se probó todo—
// y falla para las demás. Un cliente que conecta SU propia cuenta de Google
// recibía «The caller does not have permission» y veía el panel vacío.
//
// Es el patrón de siempre: funciona en la cuenta con la que se desarrolla y
// falla en la de quien paga.

import { readFileSync } from 'node:fs';
import { sinPermisoGA } from '../api/google-ads.js';

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

console.log('\nReconocer que Google niega el permiso\n');
{
  chk('en el código de error estructurado',
      sinPermisoGA({ error: { details: [{ errors: [{ errorCode: { authorizationError: 'USER_PERMISSION_DENIED' } }] }] } }));
  chk('en el mensaje suelto',
      sinPermisoGA({ error: { message: 'The caller does not have permission' } }));
  chk('cuando la cuenta no es de Ads', sinPermisoGA({ error: { message: 'NOT_ADS_USER' } }));
  chk('no confunde otros errores', !sinPermisoGA({ error: { message: 'Invalid query' } }));
  chk('una respuesta buena no es un error', !sinPermisoGA({ results: [] }));
  chk('ni una vacía', !sinPermisoGA(null));
}

console.log('\nEl orden de los intentos\n');
{
  const ga = readFileSync(new URL('../api/google-ads.js', import.meta.url), 'utf8');
  const dash = readFileSync(new URL('../api/dashboard.js', import.meta.url), 'utf8');

  chk('el administrador ya no se manda a ciegas en la lectura',
      /if \(conMcc && MCC_ID\) h\['login-customer-id'\]/.test(ga));
  chk('se intenta PRIMERO sin administrador (el caso normal)',
      /let res = await doRequest\(token, false\)/.test(ga));
  chk('y solo se reintenta con él si el problema es de permisos',
      /if \(MCC_ID && sinPermisoGA\(data\)\)[\s\S]{0,200}?doRequest\(token, true\)/.test(ga));
  chk('si el segundo también falla, se conserva el error del primero',
      /if \(!sinPermisoGA\(data2\)\) data = data2/.test(ga));
  chk('el refresco del token conserva el token nuevo para el reintento',
      /token = refreshed\.access_token/.test(ga));

  chk('el Pulso hace lo mismo', /let res = await pedir\(false\)/.test(dash));
  chk('y solo reintenta ante un problema de permisos',
      /USER_PERMISSION_DENIED\|does not have permission\|NOT_ADS_USER/.test(dash));
}

console.log('\nNadie manda el administrador a ciegas\n');
{
  // Esta es la que de verdad importa: basta UN sitio sin guardar para que un
  // cliente con cuenta propia se quede sin esa función, y son once sitios.
  const guardado = /conMcc|_negConMcc|legacyConMcc/;
  let aCiegas = [];
  for (const f of ['api/google-ads.js', 'api/dashboard.js']) {
    readFileSync(new URL('../' + f, import.meta.url), 'utf8').split('\n').forEach((linea, i) => {
      if (!linea.includes('login-customer-id')) return;
      if (linea.trim().startsWith('//') || linea.trim().startsWith('*')) return;
      if (!guardado.test(linea)) aCiegas.push(`${f}:${i + 1}`);
    });
  }
  chk('ni un solo uso sin comprobar antes de quién es la cuenta',
      aCiegas.length === 0, aCiegas.join(', '));
}

console.log('\nLa escritura también\n');
{
  const ga = readFileSync(new URL('../api/google-ads.js', import.meta.url), 'utf8');
  chk('existe el ayudante de mutaciones', /async function llamarGA\(url, token, cuerpo\)/.test(ga));
  chk('las seis llamadas de crear campaña pasan por él',
      /const gadsMutate = \(entity, operations\) => llamarGA\(/.test(ga));
  const cuantas = (ga.match(/await llamarGA\(/g) || []).length;
  chk('pausar, presupuesto y puja también', cuantas >= 4, cuantas + ' llamadas');
  chk('y se lee la respuesta del ayudante, no la del fetch',
      !/await mutateRes\.json\(\)/.test(ga));

  chk('los flujos largos lo resuelven una vez, no por llamada',
      /async function necesitaMcc\(customerId, token\)/.test(ga) &&
      /const _conMcc = await necesitaMcc\(/.test(ga) &&
      /const _negConMcc = await necesitaMcc\(/.test(ga));
  chk('ante la duda se comporta como antes (con administrador)',
      /necesitaMcc[\s\S]{0,900}?catch \{[\s\S]{0,220}?return true;/.test(ga));

  chk('la sonda de versión ya no manda administrador',
      !/const loginId = mccId \|\| customerId/.test(ga) &&
      !/const loginId = mccId \|\| customerId/.test(readFileSync(new URL('../api/dashboard.js', import.meta.url), 'utf8')));
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);

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

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);

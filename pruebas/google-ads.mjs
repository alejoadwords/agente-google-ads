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
  // Dos guardianes valen, y el segundo es el fuerte:
  //   · `conMcc` y compañía — la vieja regla de «primero sin, luego con el
  //     nuestro», que sigue cubriendo los casos 1 y 2.
  //   · `login`, el administrador que `dondePreguntar()` averiguó para ESA
  //     cuenta (api/_google-login.js). Es el caso 3, el del cliente con
  //     administrador propio, y es más preciso que los otros: no adivina.
  // Lo que NO vale es una constante suelta como MCC_ID metida a mano.
  // Se mira el VALOR que se le asigna a la cabecera, no la línea entera: la
  // clave se llama «login-customer-id», así que buscar «login» en toda la
  // línea daría por bueno hasta una constante metida a mano.
  //
  // Y se aceptan las dos formas de escribirla. La primera versión de esta
  // prueba solo entendía `'login-customer-id': login` (objeto literal); al
  // refactorizarse el código a `h['login-customer-id'] = login` se puso en
  // rojo sin que nada estuviera mal. Cuatro comprobaciones en rojo que son
  // falsas alarmas enseñan a ignorar el rojo, que es peor que no tener prueba.
  const valorBueno = /^\s*(String\()?(_?\w*[Ll]ogin|mcc|m)\b/;
  let aCiegas = [];
  for (const f of ['api/google-ads.js', 'api/dashboard.js']) {
    readFileSync(new URL('../' + f, import.meta.url), 'utf8').split('\n').forEach((linea, i) => {
      if (!linea.includes('login-customer-id')) return;
      const t = linea.trim();
      if (t.startsWith('//') || t.startsWith('*')) return;
      // El valor se saca DESPUÉS de la clave, no del primer separador de la
      // línea: en `headers: { ...otras, 'login-customer-id': login }` el
      // primero es el de `headers:` y se leía la llave equivocada.
      const m = linea.match(/login-customer-id'?\]?\s*(?::|=)\s*([^,;}]+)/);
      const valor = m ? m[1] : '';
      if (!valor.trim()) return;                       // solo menciona la clave
      const porBandera = /conMcc|_negConMcc|legacyConMcc/.test(linea);
      if (!porBandera && !valorBueno.test(valor)) aCiegas.push(`${f}:${i + 1}`);
    });
  }
  chk('ni un solo uso sin comprobar antes de quién es la cuenta',
      aCiegas.length === 0, aCiegas.join(', '));

  // Y que ese `login` sea de verdad el averiguado, no una variable cualquiera
  // que alguien llamó igual.
  const ga = readFileSync(new URL('../api/google-ads.js', import.meta.url), 'utf8');
  chk('el tercer intento existe y usa el módulo compartido',
      /import \{ dondePreguntar \} from '\.\/_google-login\.js'/.test(ga) &&
      /const login = await dondePreguntar\(/.test(ga));
  chk('y solo se intenta si los dos anteriores fallaron por permisos',
      /if \(sinPermisoGA\(data\) && userId\) \{/.test(ga));
}

console.log('\nLa escritura también\n');
{
  const ga = readFileSync(new URL('../api/google-ads.js', import.meta.url), 'utf8');
  // Sin fijar la firma exacta: ya ganó un cuarto parámetro (`login`) y eso es
  // una mejora, no una regresión. Lo que importa es que exista y que reciba el
  // administrador averiguado.
  chk('existe el ayudante de mutaciones', /async function llamarGA\(\s*url,\s*token,\s*cuerpo/.test(ga));
  chk('y el ayudante recibe el administrador de esa cuenta',
      /async function llamarGA\([^)]*\blogin\b[^)]*\)/.test(ga));
  chk('las seis llamadas de crear campaña pasan por él',
      /const gadsMutate = \(entity, operations\) => llamarGA\(/.test(ga));
  const cuantas = (ga.match(/await llamarGA\(/g) || []).length;
  chk('pausar, presupuesto y puja también', cuantas >= 4, cuantas + ' llamadas');
  chk('y se lee la respuesta del ayudante, no la del fetch',
      !/await mutateRes\.json\(\)/.test(ga));

  // `necesitaMcc()` devolvía un booleano y por eso solo sabía expresar dos de
  // los tres casos; se reemplazó por `loginParaCuenta()`, que devuelve el
  // administrador real o null. Es el arreglo del caso de Certain, así que la
  // prueba exige el diseño NUEVO, no el viejo.
  chk('los flujos largos resuelven el administrador una vez, no por llamada',
      /async function loginParaCuenta\(customerId, token/.test(ga) &&
      /await loginParaCuenta\(/.test(ga));
  chk('y devuelve el identificador, no un sí/no',
      /Devuelve el id a mandar, o `null`/.test(ga));
  // Se mira DENTRO del cuerpo de la función en vez de con una ventana de
  // caracteres a ojo: la función creció y la ventana se quedó corta, que es
  // otra forma de rojo falso.
  const cuerpoLPC = (ga.split('async function loginParaCuenta')[1] || '').split('\n}\n')[0];
  chk('ante la duda se comporta como antes (con nuestro administrador)',
      /catch \s*\{[\s\S]{0,300}?return mcc;/.test(cuerpoLPC));

  chk('la sonda de versión ya no manda administrador',
      !/const loginId = mccId \|\| customerId/.test(ga) &&
      !/const loginId = mccId \|\| customerId/.test(readFileSync(new URL('../api/dashboard.js', import.meta.url), 'utf8')));
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);

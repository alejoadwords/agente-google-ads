// El administrador correcto también al ESCRIBIR: node pruebas/google-ads-escritura.mjs
//
// El camino de lectura ya resolvía los tres casos del `login-customer-id`. El
// de escritura se quedaba en dos —`necesitaMcc()` devolvía un booleano, que
// solo sabe decir «sin administrador» o «el NUESTRO»—, así que un cliente
// cuya cuenta cuelga de su propio administrador veía su panel pero no podía
// crear una campaña.
//
// No se llama a Google: se le pone delante un `fetch` de mentira que responde
// como responde Google en cada uno de los tres casos, y se mira QUÉ cabecera
// acabó mandando.

import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../api/google-ads.js', import.meta.url), 'utf8');

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

// ── 1. Que no quede nada del booleano ───────────────────────────────────────
console.log('\nEl booleano no sobrevive en ningún sitio\n');
{
  // Fuera de los comentarios, que sí lo nombran para explicar por qué se fue.
  const codigo = js.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  chk('no queda ninguna llamada a necesitaMcc()', !/necesitaMcc\s*\(/.test(codigo));
  chk('no queda ninguna variable conMcc en el camino de escritura',
      !/_(neg)?ConMcc|legacyConMcc/.test(codigo));
}

// ── 2. Que TODAS las mutaciones pasen el administrador ──────────────────────
console.log('\nTodas las mutaciones reciben el administrador resuelto\n');
{
  // Es lo que se deshace solo: `llamarGA` tiene el parámetro, alguien añade una
  // llamada nueva sin pasarlo, y esa mutación vuelve a ir sin cabecera sin que
  // nada se queje.
  const llamadas = [...js.matchAll(/(?<!function )llamarGA\(([\s\S]{0,700}?)\n\s*\);/g)];
  chk('se encuentran las cinco llamadas', llamadas.length === 5, String(llamadas.length));
  for (const [i, m] of llamadas.entries()) {
    chk(`la mutación ${i + 1} pasa el login`, /login|Login/.test(m[1]),
        m[1].replace(/\s+/g, ' ').slice(0, 60));
  }
}

// ── 3. Los tres casos, ejecutando la función de verdad ──────────────────────
console.log('\nLos tres casos del login-customer-id\n');
{
  const NEGADO = { error: { message: 'The caller does not have permission' } };
  const BIEN = { results: [{ customer: { id: '1' } }] };
  const MCC = '2432598177';
  const DEL_CLIENTE = '9998887777';

  // Se extrae el trozo y se ejecuta con un `fetch` de mentira. Así se prueba la
  // función real, no una copia que puede quedarse vieja.
  const trozo = (desde, hasta) => {
    const a = js.indexOf(desde);
    if (a < 0) throw new Error('No encontré en google-ads.js: ' + desde);
    const b = js.indexOf(hasta, a);
    if (b < 0) throw new Error('No encontré el final: ' + hasta);
    return js.slice(a, b);
  };
  const cuerpo = trozo('async function loginParaCuenta(', '\n/**');

  // `dueno` dice a qué administrador responde bien esta cuenta:
  //   null → se llega directo · MCC → el nuestro · DEL_CLIENTE → el suyo
  function montar(dueno, { hayModulo = true } = {}) {
    const vistas = [];
    const fetchFalso = async (url, opciones) => {
      const h = (opciones && opciones.headers) || {};
      const login = h['login-customer-id'] || null;
      vistas.push(login);
      const ok = (login || null) === (dueno || null);
      return { ok, json: async () => (ok ? BIEN : NEGADO) };
    };
    const entorno = {
      fetch: fetchFalso,
      MCC_ID: MCC,
      DEV_TOKEN: 'dev',
      SUPABASE_URL: 'https://sb',
      SUPABASE_SERVICE_KEY: 'k',
      getApiVersion: async () => 21,
      getConexionGoogle: async () => ({ id: 'c1', extra_data: {} }),
      sinPermisoGA: (d) => !!(d && d.error && /does not have permission/.test(JSON.stringify(d.error))),
      // El módulo de los tres casos: aquí se simula que encuentra —o no— el
      // administrador del cliente.
      dondePreguntar: async () => (hayModulo ? DEL_CLIENTE : null),
    };
    const nombres = Object.keys(entorno);
    const fn = new Function(...nombres, cuerpo + '\nreturn loginParaCuenta;')(...nombres.map(n => entorno[n]));
    return { fn, vistas };
  }

  {
    const { fn, vistas } = montar(null);
    const r = await fn('123', 'tok', 'u1');
    chk('cuenta propia del usuario → sin cabecera', r === null, String(r));
    chk('y no se molesta a nadie más', vistas.length === 1, JSON.stringify(vistas));
  }
  {
    const { fn } = montar(MCC);
    const r = await fn('123', 'tok', 'u1');
    chk('cuelga de NUESTRO administrador → el nuestro', r === MCC, String(r));
  }
  {
    // El que rompía: la cuenta de Certain.
    const { fn, vistas } = montar(DEL_CLIENTE);
    const r = await fn('6117775900', 'tok', 'u1');
    chk('cuelga del administrador DEL CLIENTE → el suyo', r === DEL_CLIENTE, String(r));
    chk('se intentó primero sin cabecera y luego con la nuestra',
        vistas[0] === null && vistas[1] === MCC, JSON.stringify(vistas));
  }
  {
    // Sin camino: mejor el error de siempre que uno nuevo por no mandar nada.
    const { fn } = montar('otro-que-nadie-conoce', { hayModulo: false });
    const r = await fn('123', 'tok', 'u1');
    chk('si no hay camino, se cae al nuestro', r === MCC, String(r));
  }
  {
    // Sin userId no se puede buscar el administrador del cliente, pero la
    // función no puede reventar por eso.
    const { fn } = montar(DEL_CLIENTE);
    const r = await fn('123', 'tok', null);
    chk('sin userId no revienta: devuelve el nuestro', r === MCC, String(r));
  }
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);

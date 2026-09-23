// El medidor de uso por pantalla: node pruebas/uso-pantallas.mjs
//
// Un instrumento que no dispara no se distingue de «aquí no pasa nada», y
// encima convence de que no hay nada que medir. Ya pasó el 22-09-2026 con el
// vigilante de `lead.stage`, puesto después del await que quería cazar.
//
// Por eso lo primero que se comprueba aquí no es la lógica: es DÓNDE está
// puesto el gancho.

import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/uso-pantallas.js', import.meta.url), 'utf8');

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

console.log('\nEl gancho está donde sí dispara\n');
{
  const i = js.indexOf('function sync() {');
  const cuerpo = js.slice(i, js.indexOf('\n  }', i));
  const posMedir = cuerpo.indexOf('medirPantalla(path)');
  const posReturn = cuerpo.indexOf('if (location.pathname === path) return;');
  chk('se mide dentro de sync()', posMedir > 0, String(posMedir));
  chk('existe el return temprano que hay que sortear', posReturn > 0);
  // ESTA es la aserción que protege todo lo demás: en la primera carga la URL
  // ya coincide con la pantalla, así que sync() se sale por ese return. Medir
  // después dejaría sin contar la pantalla de entrada, para siempre y sin que
  // nada fallara.
  chk('se mide ANTES del return, o la primera pantalla no se cuenta nunca',
      posMedir > 0 && posMedir < posReturn, `medir=${posMedir} return=${posReturn}`);
}

// ── La lógica del navegador, ejecutada de verdad ────────────────────────────
const bloque = js.slice(js.indexOf('// ── Qué pantallas se usan de verdad'));
const codigo = bloque.slice(0, bloque.indexOf('function medirUsoDePantallas'));
let _envios = [];
const entorno = {
  window: { matchMedia: () => ({ matches: true }) },
  fetchAuth: async (u, o) => { _envios.push(JSON.parse(o.body)); return { ok: true }; },
  alDOMListo: (f) => f(),
};
const nombres = Object.keys(entorno);
const M = new Function(...nombres, codigo + `
  return { medirPantalla, usoNormalizar, usoCerrarActual, usoEnviar,
           cola: () => _usoCola, ponCola: (c) => { _usoCola = c; },
           actual: () => _usoActual };
`)(...nombres.map(n => entorno[n]));

console.log('\nNo se guarda de quién es el lead\n');
{
  chk('la ficha de un lead es UNA pantalla, no una por contacto',
      M.usoNormalizar('/crm/lead/abc-123-def') === '/crm/lead', M.usoNormalizar('/crm/lead/abc-123-def'));
  chk('lo mismo con los agentes', M.usoNormalizar('/agente/google-ads') === '/agente');
  chk('el resto se deja igual', M.usoNormalizar('/marketing/pauta') === '/marketing/pauta');
  chk('la raíz no se rompe', M.usoNormalizar('/') === '/');
}

console.log('\nCuenta visitas y tiempo, no repeticiones\n');
{
  M.ponCola([]);
  M.medirPantalla('/crm');
  chk('la primera pantalla no se apunta hasta salir de ella', M.cola().length === 0);
  M.medirPantalla('/crm');
  chk('volver a la MISMA no cuenta como visita nueva', M.cola().length === 0, JSON.stringify(M.cola()));
  M.medirPantalla('/conversaciones');
  chk('cambiar de pantalla cierra la anterior', M.cola().length === 1 && M.cola()[0].p === '/crm', JSON.stringify(M.cola()));
  chk('con su tiempo', typeof M.cola()[0].ms === 'number' && M.cola()[0].ms >= 0);
  chk('y sabiendo si fue en móvil', M.cola()[0].m === true);
}

console.log('\nEl último tramo no se pierde al irse\n');
{
  M.medirPantalla('/analisis');
  M.ponCola([]);          // se vacía DESPUÉS de entrar: al entrar se apunta la anterior
  M.usoCerrarActual();
  const ultima = M.cola()[M.cola().length - 1];
  chk('cerrar apunta la pantalla abierta',
      M.cola().length === 1 && ultima?.p === '/analisis', JSON.stringify(M.cola()));
  // Justo el tramo que dice dónde estaba trabajando alguien cuando se fue.
  chk('y la deja abierta para seguir contando si vuelve', M.actual()?.p === '/analisis');
}

console.log('\nSi el envío falla, no se pierde ni se acumula sin fin\n');
{
  M.ponCola([{ p: '/crm', ms: 10, m: true }]);
  const antes = entorno.fetchAuth;
  const fallido = new Function('M', 'return async () => ({ ok: false })')();
  // Se sustituye el envío por uno que rechaza.
  const M2 = new Function(...nombres, codigo + '\nreturn { usoEnviar, cola: () => _usoCola, ponCola: (c) => { _usoCola = c; } };')(
    ...nombres.map(n => (n === 'fetchAuth' ? fallido : entorno[n])));
  M2.ponCola([{ p: '/crm', ms: 10, m: true }]);
  await M2.usoEnviar();
  chk('lo rechazado vuelve a la cola', M2.cola().length === 1, JSON.stringify(M2.cola()));
  entorno.fetchAuth = antes;

  M.ponCola(new Array(250).fill(0).map((_, i) => ({ p: '/crm', ms: i, m: true })));
  M.medirPantalla('/x1'); M.medirPantalla('/x2');
  chk('la cola no crece sin fin', M.cola().length <= 200, String(M.cola().length));
}

console.log('\nEl servidor no se cree lo que le manden\n');
{
  chk('exige sesión', /if \(!userId\) return json\(\{ error: 'No autorizado' \}, 401\)/.test(api));
  chk('solo acepta pantallas declaradas', /PANTALLAS\.has\(v\?\.p\) \? v\.p : '\(otra\)'/.test(api));
  chk('recorta un tiempo absurdo en vez de tirar la visita', /Math\.min\(Number\(v\?\.ms\) \|\| 0, 7200000\)/.test(api));
  chk('junta las repeticiones antes de tocar la base', /porClave/.test(api));
  chk('limita cuántas acepta de golpe', /slice\(0, 60\)/.test(api));
  chk('dice cuántas entraron de las pedidas', /guardadas, pedidas/.test(api));
  chk('suma de forma atómica con la función de la base', /rpc\/sumar_uso_pantalla/.test(api));
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);

// Los mensajes sin leer en el Pulso: node pruebas/pulso-avisos.mjs
//
// Las notas que la dirección le deja a un asesor solo las anunciaba la
// campana. Quien no mira la campana no se entera, y un mensaje de su jefe
// podía pasar días sin leerse mientras el Pulso decía que todo iba bien.
//
// Lo que aquí se comprueba es DÓNDE está la tarjeta, no que exista. En el
// primer intento la metí dentro de pulsoCrmCards, que se rinde temprano tres
// veces: un asesor sin leads asignados —o un fallo de red al pedirlos— no
// habría visto el mensaje, y nada habría fallado.

import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

console.log('\nLa tarjeta no cuelga de nada que se rinda antes\n');
{
  const i = js.indexOf('async function pulsoAvisosCards');
  chk('existe como fuente propia', i > 0);

  const crm = js.indexOf('async function pulsoCrmCards');
  const cuerpoCrm = js.slice(crm, js.indexOf('\n}', crm));
  // Si vuelve a meterse ahí dentro, estos tres `return []` la apagan.
  chk('NO está dentro de pulsoCrmCards, que se rinde temprano',
      !cuerpoCrm.includes('crmAvisosCargar'),
      'los return tempranos de pulsoCrmCards: ' + (cuerpoCrm.match(/return \[\];/g) || []).length);

  const propia = js.slice(i, js.indexOf('\n}\n', i));
  chk('no depende de que haya leads', !/\/api\/leads/.test(propia));
  chk('un fallo suyo no tumba el resto del Pulso', /catch \(e\)[\s\S]{0,80}return \[\];/.test(propia));
}

console.log('\nSale la primera, en las dos versiones del Pulso\n');
{
  // Es lo único del Pulso que otra persona escribió esperando respuesta;
  // debajo de la inversión en Google Ads se lee tarde o no se lee.
  const composiciones = [...js.matchAll(/Promise\.allSettled\(\[([^\]]*pulsoCrmCards\(\)[^\]]*)\]\)/g)]
    .map(m => m[1]);
  chk('se encuentran las dos composiciones', composiciones.length === 2, String(composiciones.length));
  for (const [n, c] of composiciones.entries()) {
    chk(`en la composición ${n + 1} va primero`,
        c.trim().startsWith('pulsoAvisosCards()'), c.trim().slice(0, 60));
  }
}

console.log('\nDice de qué va el mensaje, no solo que existe\n');
{
  const i = js.indexOf('async function pulsoAvisosCards');
  const propia = js.slice(i, js.indexOf('\n}\n', i));
  chk('muestra un trozo del texto', /texto\.slice\(0, 90\)/.test(propia));
  chk('y avisa si lo cortó', /texto\.length > 90 \? '…'/.test(propia));
  chk('dice quién escribió', /a\.autor/.test(propia));
  chk('y sobre qué contacto', /a\.lead/.test(propia));
  chk('el tono es de aviso, no informativo', /tone: 'warn'/.test(propia));
  chk('el botón lleva a la campana', /openAlertsPanel\(\)/.test(propia));
  // Singular y plural: «1 mensajes sin leer» se lee como un descuido.
  chk('distingue singular de plural', /=== 1 \? '1 mensaje sin leer'/.test(propia));
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);

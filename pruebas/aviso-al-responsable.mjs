// El aviso al responsable cuando su contacto vuelve a escribir:
//   node pruebas/aviso-al-responsable.mjs
//
// Al calificar, la conversación pasa a manos de una persona y el agente deja de
// contestar. Hasta ahora, cuando el contacto volvía a escribir solo subía el
// contador de no leídos: el comercial no se enteraba salvo que entrara al inbox
// a mirar, y el cliente se quedaba esperando una respuesta que nadie iba a dar.
//
// Se comprueba sobre el código porque el camino entero necesita base y modelo;
// la conversación real se probó ejecutándola aparte.

import { readFileSync } from 'node:fs';

const motor = readFileSync(new URL('../api/_inbox-engine.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + extra : ''));
  if (!c) mal++;
};

console.log('\nSe avisa al responsable, y solo a él');
{
  const i = motor.indexOf('async function avisarAlResponsable');
  ok(i > 0, 'la función existe');
  const fin = motor.indexOf('\n}', motor.indexOf('enviarPushA', i));
  const cuerpo = motor.slice(i, fin);

  ok(/assigned_to/.test(cuerpo), 'mira quién es el responsable del lead');
  ok(/lead\.assigned_to === userId/.test(cuerpo),
     'y al dueño de la cuenta no se le avisa de cada mensaje');
  ok(/if \(!conv\?\.lead_id\) return;/.test(cuerpo), 'sin lead no hay a quién avisar');
  ok(/metadata->>motivo=eq\.mensaje_entrante/.test(cuerpo) && /leida_at=is\.null/.test(cuerpo),
     'no repite el aviso mientras el anterior siga sin leer');
  ok(cuerpo.indexOf('yaHay') < cuerpo.indexOf('lead_activities`, {'),
     'y esa comprobación va ANTES de crear el aviso, no después');
  ok(/if \(yaHay\?\.length\) return;/.test(cuerpo),
     'y de verdad corta: preguntarlo sin usar la respuesta no frena nada');
  ok(/para: lead\.assigned_to/.test(cuerpo),
     'el aviso va dirigido a esa persona (es lo que lee la campana)');
  ok(/enviarPushA/.test(cuerpo), 'y también le llega al móvil');
  ok(/etiqueta: 'inbox-' \+ conv\.id/.test(cuerpo),
     'con una etiqueta por conversación, para que el móvil reemplace en vez de apilar');
}

console.log('\nY se llama desde donde el agente ya no contesta');
{
  // Si el aviso se llamara en la rama del bot, sonaría en cada mensaje de una
  // conversación que el agente está atendiendo solo.
  const rama = motor.indexOf("if (aMano || conv.status === 'human') {");
  const finRama = motor.indexOf('return { ok: true, escalated: true', rama);
  ok(rama > 0 && finRama > rama, 'la rama de «en manos de una persona» existe');
  ok(motor.slice(rama, finRama).includes('avisarAlResponsable'),
     'y el aviso se dispara ahí dentro');
  const despues = motor.slice(finRama);
  ok(!despues.slice(0, 4000).includes('avisarAlResponsable('),
     'y NO en la rama donde contesta el agente');
}

console.log('\nEl enlace del aviso abre la conversación');
{
  ok(/url: '\/conversaciones\?c=' \+ conv\.id/.test(motor), 'el push enlaza al hilo');
  ok(/searchParams\)?\.?get\('c'\)|get\('c'\)/.test(app), 'y la app lee ese parámetro');
  ok(/function inboxAbrirConvPendiente/.test(app), 'con su función de apertura');
  ok(/inboxAbrirConvPendiente\(\);/.test(app.replace(/function inboxAbrirConvPendiente[\s\S]*?\n}/, '')),
     'que alguien llama al arrancar');

  // El fallo que tenía el botón de la ficha del lead: buscaba un atributo que
  // nadie escribe, así que llevaba al inbox y ahí se quedaba, mudo.
  ok(!/querySelector\('\[data-conv-id="'/.test(app),
     'ya nadie busca un [data-conv-id], que no existe en la lista');
  ok(/onclick="inboxOpenConv\(/.test(app), 'la lista se pinta con inboxOpenConv');
  ok(/function inboxEsperarConv/.test(app), 'y se espera a que la lista esté cargada');
  const e = app.indexOf('function inboxEsperarConv');
  ok(/showToast/.test(app.slice(e, e + 1800)), 'si no aparece, se dice en voz alta');
}

console.log('');
process.exit(mal ? 1 : 0);

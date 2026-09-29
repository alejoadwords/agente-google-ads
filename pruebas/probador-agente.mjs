// Probar el agente sin encenderlo: node pruebas/probador-agente.mjs
//
// Hasta ahora un agente se publicaba a ciegas: la primera conversación de
// verdad era también la primera prueba, y la hacía un cliente del cliente.
//
// La promesa del probador es doble, y las dos se pueden romper sin que nada
// falle a la vista:
//
//   1. QUE NO ESCRIBA NADA. Si un día alguien reutiliza este camino y se le
//      cuela un upsert, probar el agente ensuciaría el CRM con leads falsos —y
//      lo descubriríamos por un cliente preguntando quién es «Prueba Prueba».
//   2. QUE RESPONDA IGUAL QUE EN PRODUCCIÓN. Un probador que arma el prompt de
//      otra forma no prueba nada: da luz verde a un agente que luego se
//      comporta distinto. Es peor que no tenerlo.
//
// Y una tercera, que es la razón de la radiografía: que lo que en producción va
// oculto —qué capturó, a qué ruta manda, si el catálogo se filtró— aquí se vea.

import { readFileSync } from 'node:fs';

const eng = readFileSync(new URL('../api/_inbox-engine.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/agent-probar.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const htm = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra ? ' → ' + extra : ''));
  if (!c) mal++;
};

// El cuerpo de ensayarAgente, aislado por anclas estructurales y no por
// ventanas de caracteres: una ventana se desplaza en cuanto alguien añade un
// comentario, y la prueba pasa a mirar otra función sin avisar.
const iniEnsayo = eng.indexOf('export async function ensayarAgente(');
const finEnsayo = eng.indexOf('export async function upsertLeadFromConversation(');
ok(iniEnsayo > 0 && finEnsayo > iniEnsayo, 'ensayarAgente existe y está delimitada');
const cuerpo = eng.slice(iniEnsayo, finEnsayo);

// ── 1. No escribe nada ──────────────────────────────────────────────────────
console.log('\nNo toca el CRM');

// Cualquier escritura a PostgREST pasa por un method distinto de GET.
const escrituras = [...cuerpo.matchAll(/method:\s*'(POST|PATCH|PUT|DELETE)'/g)].map(m => m[1]);
ok(escrituras.length === 0,
   'ni un POST, PATCH, PUT o DELETE en todo el ensayo', escrituras.join(', '));

for (const prohibida of ['upsertLeadFromConversation', 'aplicarVeredicto']) {
  ok(!cuerpo.includes(prohibida),
     `no llama a ${prohibida}: es lo que crea el lead y le pone etiquetas`);
}
for (const tabla of ['chat_conversations', 'chat_messages', 'leads?', 'lead_activities']) {
  ok(!cuerpo.includes(tabla), `no escribe en ${tabla}`);
}

// Las lecturas que sí hace, que son las que lo vuelven fiel.
ok(/chat_agents\?id=eq\./.test(cuerpo), 'lee el agente de la base, no del formulario');
ok(/user_id=eq\.\$\{encodeURIComponent\(userId\)\}/.test(cuerpo),
   'y acotado al dueño: sin eso se podría probar el agente de otra cuenta con su id');

// El gasto sí tiene que constar: es dinero de verdad.
ok(/origen = 'ensayo'/.test(cuerpo),
   'el consumo se registra con origen propio, para poder verlo y ponerle tope');
ok(/responderViendo\(system, limpios, \[\], \{ userId, origen \}\)/.test(cuerpo),
   'y ese origen llega al registro, no se queda en el argumento');

// ── 2. Responde igual que en producción ─────────────────────────────────────
console.log('\nMismo prompt, mismo inventario, misma regla');

// La comparación se hace contra el camino real, no contra una lista escrita a
// mano: si mañana se le añade un argumento a buildSystemPrompt, esto lo nota.
const iniProd = eng.indexOf('export async function processIncoming(');
const prod = eng.slice(iniProd);
const argsDe = (src) => {
  const i = src.indexOf('buildSystemPrompt(');
  if (i < 0) return null;
  let prof = 0, j = i + 'buildSystemPrompt'.length;
  for (; j < src.length; j++) {
    if (src[j] === '(') prof++;
    else if (src[j] === ')') { prof--; if (!prof) break; }
  }
  // Se cuentan los argumentos de primer nivel, no las comas de dentro.
  const dentro = src.slice(i + 'buildSystemPrompt('.length, j);
  let p = 0, n = 1;
  for (const ch of dentro) {
    if ('([{'.includes(ch)) p++;
    else if (')]}'.includes(ch)) p--;
    else if (ch === ',' && p === 0) n++;
  }
  return n;
};
ok(argsDe(cuerpo) === argsDe(prod),
   'le pasa a buildSystemPrompt los mismos argumentos que la conversación real',
   'ensayo: ' + argsDe(cuerpo) + ', producción: ' + argsDe(prod));

ok(/propiedadesParaPrompt\(/.test(cuerpo), 'usa el mismo filtro de catálogo');
ok(/getRegla\(/.test(cuerpo) && /evaluar\(/.test(cuerpo),
   'y la misma regla de calificación, evaluada por el mismo código');

// Las pistas del filtro se calculan con la MISMA función que en producción. Se
// comprobaban una por una por su nombre, y eso se rompió el día que dejaron de
// escribirse a mano: la prueba se puso roja mientras el probador hacía
// exactamente lo correcto. Lo que importa no es cómo se escriben, es que sea el
// mismo código.
ok(/pistasDeBusqueda\(/.test(cuerpo), 'el ensayo calcula las pistas con pistasDeBusqueda');
ok((eng.match(/pistasDeBusqueda\(/g) || []).length >= 4,
   'la misma que usan la conversación real y la respuesta sugerida',
   String((eng.match(/pistasDeBusqueda\(/g) || []).length));

// ── 3. La memoria del ensayo ────────────────────────────────────────────────
console.log('\nEl historial se acuerda de lo capturado');

ok(/extractCapturedData\(deAsistente\)/.test(cuerpo) && /extraerCalificacion\(deAsistente\)/.test(cuerpo),
   'lo capturado y lo calificado se releen del historial que manda el navegador');
ok(/bruto,/.test(cuerpo),
   'y la respuesta se devuelve también EN BRUTO, con los bloques dentro');
ok(/agPrbHist\.push\(\{ role: 'assistant', content: d\.bruto \}\)/.test(app),
   'el navegador guarda el bruto en el historial, no el texto limpio');
ok(/agPrbVista\.push\(\{ role: 'assistant', content: d\.texto \}\)/.test(app),
   'y pinta el limpio: si guardara el limpio, el ensayo se quedaría amnésico');

// Un turno que falla no puede quedarse en el historial: el siguiente envío
// mandaría dos mensajes de cliente seguidos y el error se repetiría solo.
const iniEnviar = app.indexOf('async function agPrbEnviar()');
const finEnviar = app.indexOf('function agRenderChannels(agent)');
const enviar = app.slice(iniEnviar, finEnviar);
ok((enviar.match(/agPrbHist\.pop\(\)/g) || []).length >= 2,
   'si el envío falla, el turno se retira del historial');

// ── 4. El tope de gasto ─────────────────────────────────────────────────────
console.log('\nUn chat con IA es una puerta a gastar');

// No basta con que la palabra aparezca: tiene que estar declarada Y comparada.
// Con solo buscar el nombre, poner el if en `false` dejaba la prueba en verde y
// el tope abierto.
ok(/const TOPE_DIARIO\s*=\s*\d+/.test(api), 'el tope diario está declarado');
ok(/if \(usados >= TOPE_DIARIO\)/.test(api),
   'y se compara de verdad contra lo consumido antes de responder');
ok(/origen=eq\.ensayo/.test(api) && /ai_usage/.test(api),
   'y se cuenta sobre ai_usage, donde consta el gasto: no hay contador aparte que se desincronice');
ok(/return 0;/.test(api.slice(api.indexOf('async function ensayosDeHoy'))),
   'si no se puede contar, no bloquea: dejar a alguien sin probar su agente es peor');
ok(/429/.test(api), 'al llegar al tope responde 429, no un error genérico');

// ── 5. La radiografía enseña lo que se esconde ──────────────────────────────
console.log('\nLo que en producción va oculto, aquí se ve');

ok(/reconocida: !!destino/.test(cuerpo),
   'el servidor avisa si el modelo devolvió una ruta que el enrutado no conoce');
ok(/asignada: !!destino\?\.asignar_a/.test(cuerpo),
   'y si esa ruta no tiene asesor asignado');
const rx = app.slice(app.indexOf('function agPrbRadiografia('), app.indexOf('async function agPrbEnviar()'));
ok(/no está entre tus opciones/.test(rx),
   'la pantalla lo dice con palabras, no con un booleano');
ok(/Sin filtrar: le está viendo las más baratas de todo el inventario/.test(rx),
   'y avisa cuando el catálogo no se filtró, que es el fallo que no se nota en la respuesta');
ok(/ag-prb-mal/.test(rx) && /ag-prb-bien/.test(rx), 'lo bueno y lo malo se distinguen a la vista');

// Hay dos formas de que un lead tenga dueño: un asesor fijo en la ruta, o el
// reparto por turnos entre quienes atienden ese tablero. Mirando solo la
// primera, la radiografía decía «Sin asesor asignado» con el equipo
// perfectamente repartido, y mandaba a arreglar algo que ya estaba bien.
ok(/asignada: !!destino\?\.asignar_a \|\| porTurnos > 0/.test(cuerpo),
   'el reparto por turnos también cuenta como tener dueño');
ok(/asesoresDelTablero\(userId, destino\.pipeline_id\)/.test(cuerpo),
   'y se cuenta a quienes atienden ese tablero');
ok(/Por turnos entre/.test(rx), 'la pantalla dice entre cuántos se reparte');

// Al agente se le pide resaltar con UN asterisco, que es la negrita de
// WhatsApp. En la prueba se veía el asterisco en crudo y parecía un fallo
// suyo: lo que el cliente ve en su teléfono es la palabra en negrita. Una
// prueba que no se parece al resultado no sirve para aprobar nada.
console.log('\nLa negrita de WhatsApp se ve como negrita');
const iNeg = app.indexOf('function negritaWa(');
ok(iNeg > 0, 'existe negritaWa');
const negritaWa = new Function('esc', app.slice(iNeg, app.indexOf('function agPrbPintar()')) + '; return negritaWa;')(
  (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
ok(negritaWa('*así* se resalta') === '<strong>así</strong> se resalta', 'un asterisco a cada lado, negrita',
   negritaWa('*así* se resalta'));
ok(negritaWa('dos *palabras* y *otra* más') === 'dos <strong>palabras</strong> y <strong>otra</strong> más',
   'varias en el mismo mensaje');
ok(negritaWa('2*3 no es negrita') === '2*3 no es negrita', 'una multiplicación no lo es');
ok(negritaWa('un * suelto') === 'un * suelto', 'ni un asterisco suelto');
ok(negritaWa('**doble**') === '**doble**', 'ni el doble asterisco, que en WhatsApp no es nada');
ok(negritaWa('<script>') === '&lt;script&gt;', 'y lo que escriba el contacto se sigue escapando');
ok(/negritaWa\(m\.content\)/.test(app), 'y se usa al pintar las burbujas');

// ── 6. La pantalla existe y usa piezas que existen ──────────────────────────
console.log('\nLa interfaz');

ok(/const AG_PASOS = \[[^\]]*'Probar'\]/.test(app), 'el paso «Probar» está en el editor');
ok(/if \(n === 6\) return !!agEditingId;/.test(app),
   'y solo aparece con el agente ya guardado: el ensayo lee la config de la base');
ok(/agPrbReiniciar\(\);/.test(app.slice(app.indexOf('function crmOpenAgentModal'))),
   'al abrir el modal el ensayo anterior se borra: era otra configuración');
ok(/data-paso="6"/.test(htm), 'el paso 6 existe en el HTML');

// Un token o una clase inventados no fallan: solo se ven mal.
const cssProbador = htm.slice(htm.indexOf('.ag-probar{'), htm.indexOf('@media(max-width:768px){.ag-probar'));
const tokens = [...new Set([...cssProbador.matchAll(/var\((--[a-z0-9-]+)\)/g)].map(m => m[1]))];
for (const t of tokens) ok(htm.includes(t + ':'), `el token ${t} existe`);
for (const c of ['btn-pri', 'btn-ghost', 'auto-input', 'crm-inbox-bubble', 'crm-section-divider']) {
  ok(new RegExp('\\.' + c + '[{.,:]').test(htm), `la clase .${c} existe`);
}
ok(/showToast\(/.test(enviar) && !/(?<![A-Za-z])toast\(/.test(enviar),
   'los avisos usan showToast, que es el que existe');

console.log('');
process.exit(mal ? 1 : 0);

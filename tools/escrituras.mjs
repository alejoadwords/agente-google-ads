// Escrituras que no miran si el servidor dijo que sí: node tools/escrituras.mjs
//
// `fetchAuth` NO lanza en 4xx ni 5xx: devuelve la respuesta igual. Un
// `await fetchAuth(..., {method:'PUT'})` sin comprobar da por bueno lo que el
// servidor rechazó, y la pantalla se queda afirmando algo que no ocurrió.
//
// Pasó de verdad, tres veces en un día: borrar un contacto lo quitaba de la
// pantalla aunque el servidor lo rechazara, reasignar anunciaba «Lead asignado
// a X» sobre un 403, y guardar un contacto decía «Error — reintentar» sin
// motivo porque el mensaje del servidor se tiraba.
//
// Comprobar vale de dos formas, y las dos cuentan aquí:
//   · `if (!res.ok) …`            — lo correcto
//   · mirar `d.error` en el cuerpo — estos endpoints devuelven {error} al
//                                    rechazar, así que también se entera
//
// Con `--todas` lista también las lecturas y las escrituras de fuera del CRM.

import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const todas = process.argv.includes('--todas');

// Lo que toca los datos del CRM. Lo de fuera —generar una imagen, pedirle algo
// a la IA— falla de otra forma y no deja la pantalla mintiendo sobre un dato.
const DEL_CRM = /\/api\/(leads|lead-activities|lead-tags|lead-lists|agenda|proposals|team|forms|automations|campaigns|close-reasons|pipeline-stages|pipelines|qualify-rules|quick-replies|chat-conversations|channel-connections|nps)\b/;

// Marcadas a mano: son «dispara y olvida» a propósito, y el comentario de al
// lado lo explica. Si una deja de serlo, se quita de aquí.
const A_PROPOSITO = [
  'close-reasons',        // guardar el motivo nuevo en el catálogo, accesorio
  'lead-activities?avisos=1',
];

const sitios = [];
const re = /fetchAuth\s*\(/g;
let m;
while ((m = re.exec(js))) {
  const ini = m.index;
  let i = js.indexOf('(', ini), prof = 0, fin = i;
  for (; fin < js.length && fin < ini + 1400; fin++) {
    const c = js[fin];
    if (c === '(') prof++;
    else if (c === ')') prof--;
    else if (c === ';' && prof === 0) break;
  }
  const sentencia = js.slice(ini, Math.min(fin + 1, js.length));
  const despues = js.slice(fin, Math.min(fin + 420, js.length));
  const linea = js.slice(0, ini).split('\n').length;
  const antes = js.slice(Math.max(0, ini - 90), ini);
  const varm = antes.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?$/);
  const nombre = varm ? varm[1] : null;

  const mira = /\.ok\b/.test(sentencia) ||
    (nombre && new RegExp('\\b' + nombre + '\\.ok\\b').test(despues)) ||
    /\.status\b\s*(===|!==|>=|<|>)/.test(sentencia + despues) ||
    /\b(?:d|data|r|res|resp|j)\.error\b/.test(despues) ||
    /if\s*\(\s*[A-Za-z_$][\w$]*\.error/.test(despues) ||
    // Mirar la cabecera también es comprobar: el endpoint de propuestas
    // responde en streaming y distingue el fallo por el `content-type`.
    (nombre && new RegExp('\\b' + nombre + '\\.headers\\.get\\b').test(despues));

  const escribe = /method:\s*'(POST|PUT|PATCH|DELETE)'/.test(sentencia);
  const crm = DEL_CRM.test(sentencia);
  const tolerada = A_PROPOSITO.some(x => sentencia.includes(x)) ||
    /\.catch\(\(\) => \{\}\)/.test(sentencia);

  sitios.push({ linea, mira, escribe, crm, tolerada,
    texto: sentencia.replace(/\s+/g, ' ').slice(0, 104) });
}

const sin = sitios.filter(s => !s.mira);
const objetivo = sin.filter(s => s.escribe && s.crm && !s.tolerada);

console.log(`\nLlamadas a fetchAuth: ${sitios.length}`);
console.log(`  comprueban la respuesta: ${sitios.length - sin.length}`);
console.log(`  no la comprueban:        ${sin.length}`);
console.log(`     escrituras del CRM sin comprobar: ${objetivo.length}`);

if (objetivo.length) {
  console.log('\nEscrituras del CRM que dan por bueno lo que el servidor rechace:\n');
  for (const s of objetivo) console.log(`  app.js:${s.linea}  ${s.texto}`);
}

if (todas) {
  const resto = sin.filter(s => !objetivo.includes(s));
  console.log(`\nEl resto sin comprobar (${resto.length}) — lecturas, cosas de fuera del CRM y las toleradas a propósito:\n`);
  for (const s of resto) console.log(`  app.js:${s.linea}  ${s.texto}`);
}

// Solo fallan las del CRM: son las que dejan la pantalla mintiendo sobre un
// dato del cliente.
console.log(objetivo.length ? `\n${objetivo.length} por arreglar\n` : '\nNinguna escritura del CRM se traga un rechazo\n');
process.exit(objetivo.length ? 1 : 0);

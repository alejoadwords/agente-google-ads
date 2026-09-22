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

// Escrituras de FUERA del CRM que se revisaron una por una el 22-09-2026 y se
// dejaron como están, con el motivo. No aparecen como pendientes; si cambia el
// motivo, se quitan de aquí y vuelven a la lista.
const REVISADAS = {
  'admin?action=save-recommendation': 'telemetría interna del panel de admin',
  'admin?action=save-snapshot':       'telemetría interna del panel de admin',
  'admin?action=log-api-action':      'bitácora interna de llamadas a proveedores',
  'novedades':                        'marcar una novedad como vista; repetirlo no cuesta nada',
  'upload-media':                     'lee el cuerpo y decide con él (upData)',
  'upload-image':                     'lee el cuerpo: sin `d.url` no sustituye la imagen',
  'generate-image':                   'sin `data.images` no añade la lámina; degrada sin mentir',
  'meta-ads':                         'devuelve el cuerpo; quien llama mira `.error`',
  'google-ads':                       'devuelve el cuerpo; quien llama lo maneja',
  'push?prueba=1':                    'mira `d.enviados` y `d.motivo` para decir qué pasó',
  'refresh-google-token':             'sin `access_token` no guarda nada; degrada',
  'whatsapp-templates':               'validación en vivo: los errores vienen en `d.errores`',
  'pauta':                            'documentado: si falla, la cuenta sigue elegida en este navegador',
};

const sitios = [];
const re = /fetchAuth\s*\(/g;
let m;
while ((m = re.exec(js))) {
  const ini = m.index;
  // La propia definición y las menciones en comentarios no son llamadas. Sin
  // esto el recuento salía inflado y daba la impresión de un problema mayor
  // del que hay.
  const inicioLinea = js.lastIndexOf('\n', ini) + 1;
  const sangria = js.slice(inicioLinea, ini);
  if (/(?:async\s+)?function\s+$/.test(sangria)) continue;
  if (/(?:^|\s)(\/\/|\*)/.test(sangria)) continue;
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
    // Cualquier `algo.error` justo después cuenta: hay sitios que lo miran con
    // otro nombre de variable (`if (sr && sr.error) …`).
    /\b[A-Za-z_$][\w$]*\.error\b/.test(despues) ||
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
// Fuera del CRM no se rompe el dato de un cliente, pero una conexión de pauta
// que se cree desconectada o un panel que se cree borrado también mienten.
const revisada = (s) => Object.keys(REVISADAS).some(k => s.texto.includes(k));
const fuera = sin.filter(s => s.escribe && !s.crm && !s.tolerada && !revisada(s));
const yaVistas = sin.filter(s => s.escribe && !s.crm && !s.tolerada && revisada(s));
const toleradas = sin.filter(s => s.escribe && s.tolerada);
const lecturas = sin.filter(s => !s.escribe);

console.log(`\nLlamadas a fetchAuth: ${sitios.length}`);
console.log(`  comprueban la respuesta: ${sitios.length - sin.length}`);
console.log(`  no la comprueban:        ${sin.length}`);
console.log(`     escrituras del CRM:              ${objetivo.length}   ← estas hacen fallar`);
console.log(`     escrituras de fuera del CRM:     ${fuera.length}   ← sin revisar`);
console.log(`     de fuera, revisadas y dejadas:   ${yaVistas.length}`);
console.log(`     dispara-y-olvida a propósito:    ${toleradas.length}`);
console.log(`     lecturas:                        ${lecturas.length}`);

const lista = (titulo, arr) => {
  if (!arr.length) return;
  console.log('\n' + titulo + '\n');
  for (const s of arr) console.log(`  app.js:${s.linea}  ${s.texto}`);
};
lista('Escrituras del CRM que dan por bueno lo que el servidor rechace:', objetivo);
if (todas) {
  lista('Escrituras de fuera del CRM sin comprobar ni revisar:', fuera);
  if (yaVistas.length) {
    console.log('\nDe fuera del CRM, revisadas y dejadas a propósito:\n');
    for (const s of yaVistas) {
      const k = Object.keys(REVISADAS).find(x => s.texto.includes(x));
      console.log(`  app.js:${s.linea}  ${k} — ${REVISADAS[k]}`);
    }
  }
  lista('Dispara-y-olvida a propósito (llevan su .catch o están en la lista):', toleradas);
  lista('Lecturas sin comprobar:', lecturas);
}

// Solo fallan las del CRM: son las que dejan la pantalla mintiendo sobre un
// dato del cliente.
console.log(objetivo.length ? `\n${objetivo.length} por arreglar\n` : '\nNinguna escritura del CRM se traga un rechazo\n');
process.exit(objetivo.length ? 1 : 0);

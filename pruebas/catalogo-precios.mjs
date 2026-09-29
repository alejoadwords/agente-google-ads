// El catálogo que el agente ofrece: node pruebas/catalogo-precios.mjs
//
// Tres fallos que no se notaban en la respuesta del agente —contestaba con el
// mismo aplomo— y que costaban ventas en silencio:
//
//   1. UN SOLO PRECIO POR INMUEBLE, sacado cogiendo el importe mayor de la
//      ficha. En una ficha que anuncia venta Y arriendo el mayor es el de
//      venta: 30 de los 469 inmuebles de Certain guardaban 800 millones donde
//      iba un canon de 3. Esos 30 desaparecían de TODA búsqueda de arriendo,
//      porque el filtro comparaba el presupuesto contra el precio de venta.
//   2. EL CATÁLOGO NUNCA SE PODABA. Solo se insertaba y se actualizaba, así
//      que un inmueble retirado de la web se quedaba para siempre. Y los que se
//      retiran son justo los que se acaban de arrendar.
//   3. LAS PISTAS NO LLEGABAN AL FILTRO. Ciudad, zona y presupuesto se
//      preguntaban en la calificación, que no alimentaba la búsqueda, y el
//      bloque de captura nunca los pedía. Visto en la primera prueba real:
//      «busco apartamento en Buenavista» → el agente lo apuntaba como criterio
//      cumplido y el catálogo le pasaba los 25 arriendos más baratos de toda la
//      costa.

import { readFileSync } from 'node:fs';
import { preciosDeTexto, precioPrincipal } from '../api/_catalogo.js';
import { aPlata, pistasDeBusqueda, habitacionesDelTexto, presupuestoDelTexto } from '../api/_inbox-engine.js';

const cat = readFileSync(new URL('../api/_catalogo.js', import.meta.url), 'utf8');
const eng = readFileSync(new URL('../api/_inbox-engine.js', import.meta.url), 'utf8');

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + extra : ''));
  if (!c) mal++;
};

// ── 1. Cada precio en su sitio ──────────────────────────────────────────────
console.log('\nUna ficha que vende Y arrienda tiene dos precios');

// Texto tal como queda una ficha de Certain al quitarle las etiquetas HTML.
const DOBLE = ' Código: 121514354 Apartamento Barranquilla Venta: $ 550,000,000 ' +
              'Arriendo: $ 2,900,000 Administración: $ 704,000 Estrato: 5 ';
const p = preciosDeTexto(DOBLE);
ok(p.precio_arriendo === 2900000, 'el canon se lee de la etiqueta «Arriendo»', p.precio_arriendo);
ok(p.precio_venta === 550000000, 'el precio de venta, de la suya', p.precio_venta);
ok(p.administracion === 704000, 'y la administración, que antes se tiraba', p.administracion);

// El fallo exacto que había: quien busca arriendo con 3 millones no veía este
// inmueble, porque se comparaba su presupuesto contra 550.000.000.
ok(p.precio_arriendo < 3000000 * 1.15,
   'con 3 millones de presupuesto, este inmueble SÍ entra por su canon');

console.log('\nY una que solo hace una cosa, uno solo');
const SOLO_V = ' Lote en Venta España, Cartagena Venta: $ 350,000,000 337 m2 ';
const v = preciosDeTexto(SOLO_V);
ok(v.precio_venta === 350000000 && v.precio_arriendo == null,
   'solo venta: el canon queda vacío, no se inventa', JSON.stringify(v));
const SOLO_A = ' Barranquilla Arriendo: $ 4,200,000 3 hab ';
const a = preciosDeTexto(SOLO_A);
ok(a.precio_arriendo === 4200000 && a.precio_venta == null,
   'solo arriendo: el de venta queda vacío', JSON.stringify(a));

console.log('\nLo que no es un precio no se cuela');
ok(preciosDeTexto(' Teléfono: 3218521992 ').precio_arriendo == null,
   'un teléfono no lleva $ y no entra');
ok(preciosDeTexto(' Área: $ 337 ').precio_venta == null,
   'y un importe ridículo tampoco: por debajo de 100.000 no es un precio');
ok(Object.keys(preciosDeTexto('')).length === 0, 'sin texto, nada');
ok(Object.keys(preciosDeTexto(null)).length === 0, 'con null tampoco revienta');

// La cabecera repite el dato más abajo; manda la primera aparición.
const REPETIDO = ' Arriendo: $ 2,716,000 ... Información del inmueble Arriendo: $ 2,716,000 ';
ok(preciosDeTexto(REPETIDO).precio_arriendo === 2716000, 'un dato repetido no se duplica ni se pisa');

console.log('\nLa columna de siempre sigue teniendo el precio que toca');
ok(precioPrincipal('Arriendo', p) === 2900000, 'en un arriendo, el canon');
ok(precioPrincipal('Venta', p) === 550000000, 'en una venta, la venta');
ok(precioPrincipal('Arriendo/Venta', p) === 2900000,
   'y en uno que hace las dos, el canon: es el que se compara con un presupuesto');
ok(precioPrincipal('Arriendo', { precio_suelto: 1500000 }) === 1500000,
   'si la web no etiqueta, se usa el importe suelto antes que dejarlo sin precio');
ok(precioPrincipal('Venta', {}) === null, 'y sin nada, null, no un cero');

// ── 2. La poda ──────────────────────────────────────────────────────────────
console.log('\nLo que el sitio ya no publica, se borra');

const sync = cat.slice(cat.indexOf('export async function sincronizarLote'));
ok(/method: 'DELETE'/.test(sync), 'ahora sí hay un borrado: antes el catálogo solo crecía');
ok(/if \(terminado\)/.test(sync.slice(sync.indexOf('La barrida'))),
   'y solo al cerrar una pasada completa, nunca a mitad');
ok(/visto_en=lt\.\$\{paseDesde\}/.test(sync),
   'borra lo que no se vio en esta pasada, que es la marca que ya se escribía');

// El corte tiene que fijarse ANTES de leer nada. Con la hora del final, lo
// guardado en la primera página quedaría por detrás del corte y se borraría
// solo: la pasada se comería a sí misma.
const iSync = cat.indexOf('export async function sincronizarLote');
ok(cat.indexOf('const paseDesde', iSync) < cat.indexOf('wp-json/wp/v2/${tipo}', iSync),
   'el corte se fija antes de leer la primera página, no después');

ok(/orderby=id&order=asc/.test(cat),
   'las páginas se piden por id, no por fecha de modificación');
ok(!/orderby=modified/.test(cat),
   'porque con «modified» un inmueble editado a mitad de pasada desplaza a otro, ' +
   'que se quedaría sin visitar y la poda lo borraría estando vivo');

ok(/sobran > \(sobran \+ vivos\) \/ 3/.test(sync),
   'y hay freno: si la pasada dejaría fuera más de un tercio, no borra nada');
ok(/No se borró nada/.test(sync), 'y lo dice, en vez de callarse');
ok(/sobran == null \|\| vivos == null/.test(sync),
   'si no se puede ni contar, tampoco borra: borrar es lo único que no se deshace');

// El corte se normaliza a ISO con Z. Postgres lo devuelve como «…+00:00», y en
// una URL el «+» significa espacio: la consulta salía mal formada, daba 400 y
// la pasada terminaba diciendo «no se pudo comprobar qué inmuebles siguen
// publicados». Nunca borró nada, y el aviso era tan educado que parecía un caso
// previsto.
ok(/new Date\(fuente\.pase_desde\)\.toISOString\(\)/.test(cat),
   'el corte va en ISO con Z, no como lo devuelve Postgres');

// Y el tamaño del lote: si cambia a mitad de pasada, la paginación deja de
// apuntar a lo mismo y hay inmuebles que no se visitan en toda la vuelta. Antes
// eso era un precio viejo; con la barrida es BORRAR lo que sigue publicado.
// Medido en Certain al subir el lote de 30 a 40: 82 sin visitar, 39 de ellos
// vivos. El freno del tercio no lo habría parado, porque era el 17%.
ok(/const loteCambio = fuente\.pase_lote != null && fuente\.pase_lote !== LOTE/.test(cat),
   'se guarda con qué lote empezó la pasada');
ok(/const pagina = loteCambio \? 1 :/.test(cat),
   'y si cambia, la pasada se reinicia desde la página 1 en vez de corromperse');
ok(/pase_lote: terminado \? null : LOTE/.test(cat), 'el lote en curso se guarda con el corte');

// ── 3. Las pistas llegan al filtro ──────────────────────────────────────────
console.log('\nLo que la persona dijo llega a la búsqueda');

ok(/"ciudad": "\.\.\.", "zona": "\.\.\.", "presupuesto"/.test(eng),
   'el bloque de captura ya pide ciudad, zona y presupuesto');

const soloCaptura = pistasDeBusqueda(
  { ciudad: 'Barranquilla', zona: 'Buenavista', presupuesto: '3000000' }, {});
ok(soloCaptura.barrio === 'Buenavista' && soloCaptura.presupuesto === 3000000,
   'del bloque de captura', JSON.stringify(soloCaptura));

// El caso real: la zona la recogió la calificación, no la captura.
const soloCalif = pistasDeBusqueda({}, {
  _ruta: 'arriendo',
  zona_barrio: { valor: 'Buenavista', cumple: true },
  presupuesto: { valor: 'hasta 3 millones', cumple: true },
});
ok(soloCalif.barrio === 'Buenavista', 'y también de la calificación, emparejando por el nombre del criterio');
ok(soloCalif.presupuesto === 3000000, 'con el presupuesto en pesos, no en palabras', soloCalif.presupuesto);
ok(soloCalif.operacion === 'arriendo', 'y la operación sigue saliendo del enrutado');

const vacio = pistasDeBusqueda({}, { presupuesto: { valor: '', cumple: false } });
ok(vacio.presupuesto === null,
   'un criterio sin respuesta no es un presupuesto de cero');

// Quien pide tres habitaciones no quiere ver de dos. No se filtraba, y el
// efecto era peor que no ofrecer nada: el agente respondía «no tengo de tres,
// pero mira estas» y las de la lista eran de dos.
console.log('\nY las habitaciones, que es lo primero que se pide');
ok(pistasDeBusqueda({ habitaciones: '3' }, {}).habitaciones === 3, 'del bloque de captura');
ok(pistasDeBusqueda({}, { habitaciones_necesarias: { valor: '3 habitaciones', cumple: true } }).habitaciones === 3,
   'y de la calificación');
ok(pistasDeBusqueda({ habitaciones: 'no sé' }, {}).habitaciones === null, 'lo que no es un número, no cuenta');
ok(pistasDeBusqueda({ habitaciones: '0' }, {}).habitaciones === null, 'ni un cero');
ok(pistasDeBusqueda({ habitaciones: '900' }, {}).habitaciones === null, 'ni un disparate');
ok(/habitaciones=gte\.\$\{pistas\.habitaciones\}/.test(eng),
   'y se filtra con «al menos»: nunca se ofrece menos de lo que pidió');

// ── Las pistas salen de lo que escribió la persona ──────────────────────────
// Se le pedía al modelo que reportara ciudad, zona, presupuesto y
// habitaciones. No lo hacía. En una conversación real, con «Buenavista en
// Barranquilla» y «máximo 3 millones» escritos, reportó solo «habitaciones».
// El filtro se quedaba sin pistas y el agente ofrecía lo primero del
// inventario diciendo «tengo varias opciones en esa zona» — de otro barrio.
console.log('\nLo que pidió la persona se lee de sus palabras, no del modelo');

for (const [t, e] of [['estoy buscando un apartamento de 3 habitaciones', 3], ['de 3 alcobas', 3],
                      ['un apto 2 hab', 2], ['sin numeros', null], ['quiero 25 habitaciones', null]]) {
  ok(habitacionesDelTexto(t) === e, JSON.stringify(t) + ' → ' + e, habitacionesDelTexto(t));
}

for (const [t, e] of [['yo creo que maximo 3 millones', 3000000],
                      ['mi presupuesto es de $4.000.000', 4000000],
                      ['hasta 2,5 millones mensuales', 2500000],
                      ['pago hasta 800 mil', 800000],
                      ['quiero 3 habitaciones. mi tope es 2 millones', 2000000],
                      // Un número que no habla de dinero no es un presupuesto.
                      ['busco 3 habitaciones', null],
                      ['el codigo 121513056', null],
                      ['3 habitaciones y 2 baños', null]]) {
  ok(presupuestoDelTexto(t) === e, JSON.stringify(t) + ' → ' + e, presupuestoDelTexto(t));
}

// Un punto dentro de «$4.000.000» partía la frase en tres y el presupuesto
// desaparecía: las frases se cortan por punto SEGUIDO DE ESPACIO.
ok(/\.split\(\/\[;\\n\]\|\\\.\\s\+\//.test(eng),
   'las frases se cortan por punto y espacio, no por cualquier punto');

console.log('\nY lo que dijo la persona manda sobre lo que reportó el modelo');
const conAmbos = pistasDeBusqueda(
  { zona: 'El Prado', presupuesto: '9000000' },          // lo que reportó el modelo
  {},
  { barrio: 'Buenavista', presupuesto: 3000000 });        // lo que dijo la persona
ok(conAmbos.barrio === 'Buenavista',
   'la zona es la que pidió, no la del inmueble que el agente ofreció', conAmbos.barrio);
ok(conAmbos.presupuesto === 3000000, 'y el presupuesto también', conAmbos.presupuesto);
// Sin lectura directa se sigue usando lo del modelo: es mejor que nada.
ok(pistasDeBusqueda({ zona: 'El Prado' }, {}, {}).barrio === 'El Prado',
   'pero si no se pudo leer nada, lo del modelo sigue valiendo');

// ── Lo ÚLTIMO que dijo, no lo primero ───────────────────────────────────────
console.log('\nUna persona corrige sobre la marcha');
// Conversación real: «busco una casa de 4 habitaciones» … «¿y de 3
// habitaciones?» … «¿y en cualquier rango de precio?». Las pistas se leían de
// todo el historial de golpe y ganaba la PRIMERA mención, así que el filtro se
// quedó en cuatro habitaciones y cinco millones toda la conversación. El agente
// contestó tres veces «no tengo» teniendo SEIS apartamentos de tres
// habitaciones en Barranquilla: decía la verdad sobre una pregunta que nadie le
// había hecho.
const iBuscar = eng.indexOf('  const buscar = (fn) => {');
const buscar = eng.slice(iBuscar, eng.indexOf('const plata = buscar(', iBuscar));
ok(/for \(let i = suyos\.length - 1; i >= 0; i--\)/.test(buscar),
   'se lee del último mensaje hacia atrás');
ok(/if \(v != null\) return v;/.test(buscar), 'y gana el primero que diga algo: lo más reciente');

// «cualquier rango de precio» no es «no lo dijo»: es quitarlo. Dejando el
// presupuesto anterior puesto, la pregunta se respondía con el tope de antes.
ok(/const SIN_TOPE = /.test(eng), 'se reconoce «sin tope»');
ok(/plata === 'libre' \? null : plata/.test(eng),
   'y borra el presupuesto anterior en vez de dejarlo');
for (const t of ['en cualquier rango de precio', 'sin limite', 'no importa el precio']) {
  ok(presupuestoDelTexto(t) === 'libre', JSON.stringify(t) + ' quita el tope');
}
ok(presupuestoDelTexto('hasta 3 millones') === 3000000, 'y un tope de verdad sigue siendo un número');

// El tipo: pidió una casa y le ofrecieron un local «como lo más cercano».
// Dentro de UN mensaje también se corrige: «busco casa de 4 habitaciones. No,
// mejor apartamento de 3». Se quedaba en cuatro, el catálogo devolvía cero, y
// con cero y sin nada más que decirle el agente se inventó tres apartamentos
// con precios que no existen.
console.log('\nY dentro de un mismo mensaje también');
ok(habitacionesDelTexto('busco casa de 4 habitaciones. no mejor apartamento de 3 habitaciones') === 3,
   'gana la última mención de habitaciones',
   habitacionesDelTexto('busco casa de 4 habitaciones. no mejor apartamento de 3 habitaciones'));
ok(presupuestoDelTexto('hasta 3 millones, bueno, mejor hasta 5 millones') === 5000000,
   'y la última cifra con unidad');
ok(presupuestoDelTexto('entre 2 y 3 millones') === 3000000,
   'que en un rango es el tope, justo lo que hay que usar: se busca por debajo');

// Y el hueco que provocó la invención: con cero opciones el prompt no decía
// NADA, y el modelo llenó el silencio con inmuebles que no existen.
console.log('\nCon cero opciones, se le dice');
ok(/NO TIENES NADA QUE ENCAJE CON LO QUE TE HAN PEDIDO/.test(eng),
   'el prompt avisa explícitamente cuando no hay ni una opción');
ok(/Ni un barrio, ni un precio, ni una administración/.test(eng),
   'y le nombra lo que no puede inventarse');
ok(/\$\{propiedades && !propiedades\.lineas\.length \?/.test(eng),
   'solo cuando de verdad se buscó y no salió nada, no cuando aún no se ha buscado');

console.log('\nY el tipo de inmueble también filtra');
ok(/if \(pistas\.tipo\) q \+= `&tipo=eq\./.test(eng),
   'quien pide una casa no ve locales');
ok(/'\(e\?s\)\?'/.test(eng) || /\(e\?s\)\?/.test(eng),
   'y «apartamentos» en plural reconoce el tipo «Apartamento» del catálogo');

console.log('\nY si en ese barrio no hay nada, se amplía a la ciudad');
const amp = eng.slice(eng.indexOf('let ampliado = false;'), eng.indexOf('const lineas = (filas || []).map'));
ok(/if \(!filas\.length && pistas\.barrio\)/.test(amp),
   'solo cuando el barrio no dio nada, no siempre');
ok(/q\.replace\(`&barrio=ilike/.test(amp),
   'se quita el barrio y se dejan los demás filtros: presupuesto y habitaciones siguen');
ok(/no hay NADA que encaje/.test(eng) && /no las presentes como si fueran de ahí/.test(eng),
   'y se le dice al agente que lo diga, no que lo disimule');

console.log('\n«Tres millones» son tres millones, no tres pesos');
const plata = [
  ['$3.000.000', 3000000], ['3 millones', 3000000], ['hasta 3 millones', 3000000],
  ['3,5 millones', 3500000], ['2.5M', 2500000], ['800 mil', 800000],
  ['$ 1.200.000 mensuales', 1200000], ['550.000.000', 550000000],
  // De un rango se coge el tope: el filtro busca POR DEBAJO del presupuesto,
  // así que con el tope se enseña todo el rango y con el suelo, casi nada.
  ['entre 2 y 3 millones', 3000000],
  ['sin información', null], ['no sé', null], ['', null], [null, null],
  // Esto es lo que rompía: un «3» suelto daba un filtro de «precio menor que 3»
  // y el agente decía que no tenía nada. Mejor no filtrar que filtrar a cero.
  ['3', null],
];
for (const [txt, esp] of plata) ok(aPlata(txt) === esp, JSON.stringify(txt) + ' → ' + esp, aPlata(txt));

// ── 4. El filtro usa la columna que toca ────────────────────────────────────
console.log('\nY la búsqueda compara contra el precio correcto');

const filtro = eng.slice(eng.indexOf('export async function propiedadesParaPrompt'),
                         eng.indexOf('export function pistasDeBusqueda'));
ok(/precio_arriendo,precio_venta,administracion/.test(filtro), 'se traen los tres precios');
ok(/esArriendo \? 'precio_arriendo' : esVenta \? 'precio_venta' : null/.test(filtro),
   'y se filtra por el de la operación que la persona busca');
ok(/and\(\$\{col\}\.is\.null,precio\.lte\.\$\{tope\}\)/.test(filtro),
   'con respaldo al precio viejo mientras un catálogo no se haya vuelto a sincronizar: ' +
   'sin eso el agente se quedaría sin nada que ofrecer justo al desplegar, y en silencio');
ok(/administracion \? 'admón\. '/.test(filtro), 'la administración se le pasa al agente');
ok(/por confirmar/.test(filtro),
   'marcada como no definitiva: se publica aparte del canon y cambia');

// ── 4b. No releer lo que no cambió ──────────────────────────────────────────
console.log('\nUna ficha que no cambió no se vuelve a leer');
// Leer la ficha de un inmueble tarda ~2s y es lo único lento: 444 inmuebles son
// doce horas de reloj. Releerlos todos en cada vuelta es trabajo tirado, porque
// casi ninguno cambia. WordPress dice cuándo se modificó cada uno.
ok(/const sigueIgual = \(codigo, modified\)/.test(cat), 'se compara con la fecha de modificación guardada');
ok(/new Date\(g\.modificado\)\.getTime\(\) !== new Date\(modified\)\.getTime\(\)/.test(cat),
   'por instante y no por texto: las dos fechas vienen con formatos distintos');
ok(/if \(g\.precio_arriendo == null && g\.precio_venta == null\) return null;/.test(cat),
   'y una fila sin precios separados se relee aunque no haya cambiado: es de antes de que existieran');
ok(/reusado: true/.test(cat), 'lo reutilizado se marca');
ok(/guardadas: unicas\.length, releidas, reusadas,/.test(cat),
   'y se informa de cuántas se releyeron, para poder ver si el ahorro es real');
// Un instrumento que no llega a donde se lee no mide nada: el cron armaba su
// propio resumen y se dejaba estos dos campos por el camino.
const cronSrc = readFileSync(new URL('../api/cron-catalogo.js', import.meta.url), 'utf8');
ok(/releidas: r\.releidas, reusadas: r\.reusadas/.test(cronSrc),
   'y el cron los pasa en su resumen, que es donde se leen');

// Con el ahorro, el lote puede ser mayor sin pasarse de tiempo.
const lote = Number((cat.match(/const LOTE = (\d+)/) || [])[1]);
const aLaVez = Number((cat.match(/const A_LA_VEZ = (\d+)/) || [])[1]);
ok(lote >= 30 && lote <= 100, 'el lote es razonable: ' + lote);
ok(aLaVez >= 5 && aLaVez <= 10, 'y la concurrencia no castiga la web ajena: ' + aLaVez);
// En el peor caso —todas nuevas— el lote entero tiene que caber en el límite de
// la función. A ~2s por ficha: lote/concurrencia * 2 segundos.
ok((lote / aLaVez) * 2 <= 15, 'y en el peor caso el lote cabe en el tiempo de la función: ' +
   Math.round((lote / aLaVez) * 2) + 's');

// ── 5. Una sola implementación ──────────────────────────────────────────────
console.log('\nEl botón y el cron hacen lo mismo');
const endpoint = readFileSync(new URL('../api/knowledge-sync.js', import.meta.url), 'utf8');
const cron = readFileSync(new URL('../api/cron-catalogo.js', import.meta.url), 'utf8');
for (const [nombre, src] of [['el endpoint', endpoint], ['el cron', cron]]) {
  ok(/from '\.\/_catalogo\.js'/.test(src), `${nombre} usa el módulo compartido`);
  ok(!/preciosDeTexto|precioPrincipal/.test(src.replace(/from '\.\/_catalogo\.js'/, '')),
     `y ${nombre} no tiene su propia copia del lector de precios`);
}
ok(/Bearer \$\{CRON_SECRET\}/.test(cron), 'el cron exige el secreto');
ok(/latir\('cron-catalogo', \{ empezo:/.test(cron), 'y deja latido de entrada');

console.log('');
process.exit(mal ? 1 : 0);

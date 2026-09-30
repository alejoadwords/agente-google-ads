// Zonas en el inventario y datos que ya se tienen: node pruebas/zonas-y-ya-sabido.mjs
//
// Dos fallos del 30-09-2026 en el agente de Certain, los dos por la misma
// ventana de 12 mensajes:
//   1. «Locales en el norte de Barranquilla» → «no tengo locales en el norte»,
//      con 22 solo en Alto Prado. «El norte» se buscaba como si fuera un barrio.
//   2. «¿Me comparte su número?» a quien ya lo había dado —«ya te lo di
//      arriba»— y, en WhatsApp, a quien escribía desde ese mismo número.
const m = await import('../api/_inbox-engine.js');
let mal = 0; const ok = (c, t, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + t + (!c && extra ? ' → ' + extra : '')); if (!c) mal++; };

console.log('Zonas → barrios del catálogo');
const cat = new Map([['alto prado', 'Alto Prado'], ['villa campestre', 'Villa Campestre'], ['altos del prado (norte)', 'Altos Del Prado (Norte)'],
  ['san roque', 'San Roque'], ['los robles', 'Los Robles'], ['manzanillo', 'Manzanillo'], ['bocagrande', 'Bocagrande']]);
const norte = m.barriosDeLaZona('norte de Barranquilla', null, cat);
ok(norte?.zona === 'norte' && norte.barrios.includes('Alto Prado') && norte.barrios.includes('Villa Campestre'), 'el norte de Barranquilla incluye Alto Prado y Villa Campestre');
ok(norte.barrios.includes('Altos Del Prado (Norte)'), 'y los barrios con apellido: «Altos Del Prado (Norte)»');
ok(!norte.barrios.includes('San Roque') && !norte.barrios.includes('Los Robles'), 'pero no el centro ni Soledad');
ok(norte.ciudades.includes('puerto colombia'), 'Puerto Colombia cuenta como norte (Villa Campestre); Santo Tomás no');
ok(JSON.stringify(m.barriosDeLaZona('zona norte', 'Cartagena', cat)?.barrios) === '["Manzanillo"]', 'el norte de Cartagena es otro');
ok(m.barriosDeLaZona('Buenavista', null, cat) === null, 'un barrio normal no es una zona: se sigue buscando por nombre');

console.log('La zona dicha por la persona');
ok(m.zonaEnTexto('busco local en el norte de barranquilla') === 'norte', '«en el norte»');
ok(m.zonaEnTexto('algo por la zona sur') === 'sur', '«zona sur»');
ok(m.zonaEnTexto('necesito que sea norteño el estilo') === null, 'una palabra que empieza igual no es una zona');

console.log('Lo que ya sabemos del contacto');
ok(m.conocidoDelContacto({ canal: 'whatsapp', contactId: '573001112233' }).celular === '+573001112233', 'en WhatsApp el número es el propio chat');
ok(m.conocidoDelContacto({ canal: 'web', textosDelUsuario: ['Soy María', 'mi cel es 300 555 1234', 'y otra cosa'] }).celular === '300 555 1234', 'un número dado al principio no se olvida');
ok(!m.conocidoDelContacto({ canal: 'web', textosDelUsuario: ['presupuesto hasta 6000000', 'o 6.500.000'] }).celular, 'un presupuesto no se confunde con un teléfono');
ok(m.conocidoDelContacto({ canal: 'web', lead: { phone: '+573009998877', name: 'Ana' } }).nombre === 'Ana', 'y lo que ya está en el lead');

console.log('El prompt');
const con = m.partesDelPrompt({ name: 'X', faqs: [] }, { celular: '+573001112233' }, null, null, 'whatsapp', null);
ok(con.variable.includes('YA TIENES SU NUMERO') && con.variable.includes('este mismo WhatsApp'), 'con número: «no se lo vuelvas a pedir»');
ok(!con.estable.includes('YA TIENES'), 'y va en la parte variable (lleva el número de cada persona: arriba rompería la caché)');
ok(!m.partesDelPrompt({ name: 'X', faqs: [] }, {}, null, null, 'web', null).variable.includes('YA TIENES'), 'sin número no se dice nada');

console.log('Toda la conversación, no solo 12 mensajes');
const eng = (await import('node:fs')).readFileSync(new URL('../api/_inbox-engine.js', import.meta.url), 'utf8');
ok((eng.match(/pistasDelContacto\([^)]*suyos\.length \? suyos : hist\)/g) || []).length === 2, 'producción y sugerencias leen las pistas de hasta 80 mensajes');
ok(/pistasDelContacto\(userId, agent\.client_id \|\| null, todos\)/.test(eng), 'el probador, de toda la conversación del ensayo');
const cron = (await import('node:fs')).readFileSync(new URL('../api/cron-seguimiento.js', import.meta.url), 'utf8');
ok(/conocidoDelContacto\(/.test(cron), 'y el seguimiento de los 10 minutos tampoco vuelve a pedir el número');
console.log('No se cobra un dato por lo que pidió');
for (const [t, e] of [
  ['Perfecto, tenemos varias opciones. Antes de mostrarle las disponibles, ¿cuál es su nombre? Y un número de contacto', true],
  ['Primero necesito su número para enviarle las fotos.', true],
  ['Para poder enviarle las fotos necesito su celular.', true],
  ['Claro, le mando las fotos del de Riomar. Y para que un asesor le confirme disponibilidad, ¿me comparte un número?', false],
  ['Antes de agendar la visita, revise que el horario le sirva. ¿Le queda bien el martes?', false],
]) ok(m.condicionaAlDato(t) === e, (e ? 'se detecta: ' : 'pasa: ') + t.slice(0, 60));
ok((eng.match(/if \(condicionaAlDato\(/g) || []).length === 2, 'el guardián está en producción y en el probador');
console.log('No se pide un número que ya tenemos');
for (const [t, e] of [
  ['¿Me comparte un número para que un asesor le confirme disponibilidad?', true],
  ['Para que lo llamen ya, ¿me comparte su número de celular?', true],
  ['¿Le llamamos a este mismo número?', false],
  ['¿Me dice su nombre para dejarlo anotado?', false],
]) ok(m.pideNumero(t) === e, (e ? 'se detecta: ' : 'pasa: ') + t);
ok((eng.match(/pideNumero\(/g) || []).length >= 4, 'el guardián está en producción y en el probador');
ok(m.tutea('Déjame mostrarle las opciones') && !m.tutea('Déjeme mostrarle las opciones'), '«déjame» es tuteo; «déjeme», no');
console.log('Metraje');
const A = t => JSON.stringify(m.areaDelTexto(t));
ok(A('busco un local de unos 100 metros') === '{"min":80,"max":150}', '«unos 100 metros» es aproximado: de 80 a 150 m²');
ok(A('mínimo 80 m²') === '{"min":80,"max":null}' && A('máximo 60 metros cuadrados') === '{"min":null,"max":60}', 'mínimo y máximo');
ok(A('entre 80 y 120 metros') === '{"min":80,"max":120}', 'un rango');
ok(A('a 100 metros de la playa') === 'null', 'una distancia no es un tamaño');
ok(A('hasta 6.000.000') === 'null' && m.presupuestoDelTexto('máximo 60 metros cuadrados') === null, 'ni la plata es metraje ni el metraje es plata');
ok(/area=not\.is\.null/.test(eng) && /otroTamano/.test(eng), 'solo filtra si el catálogo tiene metraje, y si no hay de ese tamaño lo dice');
console.log('Arriendo o compra, desde el primer mensaje');
ok(m.operacionDelTexto('Busco apartamento en arriendo en Riomar') === 'arriendo', '«en arriendo» filtra arriendos');
ok(m.operacionDelTexto('quiero comprar una casa') === 'venta', '«comprar» filtra ventas');
ok(m.operacionDelTexto('quiero arrendar mi apartamento') === null, 'quien ofrece lo suyo no es una búsqueda');
ok(m.operacionDelTexto('me interesa en venta o arriendo') === null, 'si dice las dos, no se filtra');
ok(/operacion: respuestas\?\._ruta \|\| delContacto\.operacion/.test(eng), 'la calificación manda; si aún no hay, lo que dijo la persona');
process.exit(mal ? 1 : 0);

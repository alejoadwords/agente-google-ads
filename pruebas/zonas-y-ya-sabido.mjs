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
process.exit(mal ? 1 : 0);

// Qué pantallas se usan de verdad: node tools/uso.mjs [días]
//
// Lee lo que va apuntando `api/uso-pantallas.js`. Un instrumento que nadie
// puede leer está a medio hacer: el inventario de septiembre de 2026 tuvo que
// deducir el uso de las filas que cada módulo escribe, y eso deja ciegas a las
// pantallas que no escriben nada.
//
// Las credenciales salen del entorno; si no están, se dice cómo traerlas en
// vez de fallar con un `undefined` en medio de una URL.

const DIAS = Number(process.argv[2]) || 14;
const SB = process.env.SUPABASE_URL;
const SK = process.env.SUPABASE_SERVICE_KEY;

if (!SB || !SK) {
  console.error('\nFaltan SUPABASE_URL y SUPABASE_SERVICE_KEY en el entorno.');
  console.error('Se sacan de Vercel: Settings → Environment Variables.\n');
  process.exit(1);
}

const desde = new Date(Date.now() - DIAS * 864e5).toISOString().slice(0, 10);
const r = await fetch(
  `${SB}/rest/v1/uso_pantallas?dia=gte.${desde}&select=pantalla,movil,vistas,ms,user_id,dia&limit=5000`,
  { headers: { apikey: SK, Authorization: `Bearer ${SK}` } }
);
if (!r.ok) {
  console.error('No se pudo leer:', r.status, (await r.text()).slice(0, 160));
  process.exit(1);
}
const filas = await r.json();

if (!filas.length) {
  // «Cero» y «todavía no hay» son cosas distintas, y confundirlas al decidir
  // un rediseño cuesta semanas.
  console.log(`\nSin datos todavía en los últimos ${DIAS} días.`);
  console.log('El medidor empieza a apuntar cuando alguien entra a la aplicación.\n');
  process.exit(0);
}

const min = (ms) => (ms / 60000);
const acc = new Map();
for (const f of filas) {
  const a = acc.get(f.pantalla) || { pantalla: f.pantalla, vistas: 0, ms: 0, movil: 0, cuentas: new Set() };
  a.vistas += f.vistas; a.ms += Number(f.ms || 0);
  if (f.movil) a.movil += f.vistas;
  a.cuentas.add(f.user_id);
  acc.set(f.pantalla, a);
}
const orden = [...acc.values()].sort((a, b) => b.ms - a.ms);
const totalMs = orden.reduce((s, x) => s + x.ms, 0) || 1;
const totalVistas = orden.reduce((s, x) => s + x.vistas, 0);
const dias = new Set(filas.map(f => f.dia)).size;

console.log(`\nUso por pantalla · últimos ${DIAS} días (con datos en ${dias})\n`);
console.log('PANTALLA'.padEnd(24) + 'VISTAS'.padStart(8) + 'MINUTOS'.padStart(9) +
            '% TIEMPO'.padStart(10) + 'MIN/VISITA'.padStart(12) + 'MÓVIL'.padStart(8) + 'CUENTAS'.padStart(9));
console.log('─'.repeat(80));
for (const x of orden) {
  // Se ordena por TIEMPO y no por visitas a propósito: es lo que separa la
  // pantalla por la que se pasa de aquella en la que se trabaja.
  console.log(
    x.pantalla.padEnd(24) +
    String(x.vistas).padStart(8) +
    min(x.ms).toFixed(0).padStart(9) +
    (Math.round(x.ms / totalMs * 100) + '%').padStart(10) +
    min(x.ms / x.vistas).toFixed(1).padStart(12) +
    (Math.round(x.movil / x.vistas * 100) + '%').padStart(8) +
    String(x.cuentas.size).padStart(9)
  );
}
const msMovil = filas.filter(f => f.movil).reduce((s, f) => s + Number(f.ms || 0), 0);
console.log('─'.repeat(80));
console.log(`total: ${totalVistas} vistas · ${min(totalMs).toFixed(0)} minutos · ` +
            `${Math.round(msMovil / totalMs * 100)}% del tiempo en móvil\n`);
console.log('MIN/VISITA alto = pantalla donde se trabaja. Bajo = pantalla de paso.\n');

// Alertas diarias de la pauta (api/_alertas-pauta.js): node pruebas/alertas-pauta.mjs
//
// La decisión es pura: se le dan los números de cada campaña y devuelve las
// alertas. Aquí se prueba que avise de lo que importa y que NO avise de lo
// normal, que es lo que hace que un correo de alertas se deje de leer.
process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';
const { alertasDeCampanas, dias } = await import('../api/_alertas-pauta.js');

let mal = 0;
const ok = (c, t, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + t + (!c && extra ? ' → ' + extra : '')); if (!c) mal++; };
const camp = (x) => ({ red: 'meta', id: '1', nombre: 'Campaña', estado: 'active', objetivo: 'OUTCOME_LEADS', moneda: 'COP',
  semana: { inv: 700000, leads: 14 }, ayer: { inv: 100000, leads: 2 }, dos: { inv: 200000, leads: 4 }, ...x });
const tipos = (c) => alertasDeCampanas([camp(c)]).map(a => a.tipo).join(',');

console.log('Lo normal no alerta');
ok(tipos({}) === '', 'una campaña que gasta y trae lo de siempre: ninguna alerta');
ok(tipos({ ayer: { inv: 180000, leads: 3 }, dos: { inv: 280000, leads: 5 } }) === '', 'gastar un 80 % más no es «disparado» (umbral: el doble)');

console.log('Dejó de entregar');
ok(tipos({ ayer: { inv: 0, leads: 0 }, dos: { inv: 100000, leads: 2 } }) === 'detenida', 'activa, gastó anteayer y ayer cero → detenida');
ok(tipos({ estado: 'paused', ayer: { inv: 0, leads: 0 }, dos: { inv: 100000, leads: 2 } }) === '', 'si la pausaron a propósito, no es una alerta');
ok(tipos({ ayer: { inv: 0, leads: 0 }, dos: { inv: 0, leads: 0 } }) === 'sin_leads' || tipos({ ayer: { inv: 0, leads: 0 }, dos: { inv: 0, leads: 0 } }) === '',
   'si ya llevaba dos días sin gastar, no se repite «detenida» como si fuera de ayer');
ok(alertasDeCampanas([camp({ ayer: { inv: 0, leads: 0 }, dos: { inv: 100000, leads: 2 } })]).length === 1, 'una detenida no suma además «sin leads»');

console.log('Gasto disparado');
const g = alertasDeCampanas([camp({ ayer: { inv: 250000, leads: 2 }, dos: { inv: 350000, leads: 4 } })])[0] || {};
ok(g.tipo === 'gasto' && /2,5 veces/.test(g.titulo), 'ayer gastó 2,5 veces el promedio diario → gasto', g.titulo);
ok(/100\.000/.test(g.detalle) && /Trajo 2 leads/.test(g.detalle), 'dice el promedio y cuántos leads trajo');

console.log('Costo por lead real disparado');
const p = alertasDeCampanas([camp({ dos: { inv: 220000, leads: 1 } })])[0] || {};
ok(p.tipo === 'cpl' && /4,4 veces/.test(p.titulo), 'últimos 2 días a 220.000 por lead contra 50.000 → cpl', p.titulo);
ok(tipos({ semana: { inv: 700000, leads: 2 }, dos: { inv: 220000, leads: 1 } }) === '', 'con menos de 3 leads en la semana no se juzga el costo por lead');

console.log('Gasta sin traer leads');
const s = alertasDeCampanas([camp({ dos: { inv: 120000, leads: 0 }, ayer: { inv: 60000, leads: 0 } })])[0] || {};
ok(s.tipo === 'sin_leads' && s.gravedad === 'alta', '2 días, lo de más de 2 leads y ninguno al CRM → sin_leads (alta)');
ok(tipos({ dos: { inv: 80000, leads: 0 }, ayer: { inv: 40000, leads: 0 } }) === '', 'gastar menos de lo que cuestan 2 leads aún no es alarma');
ok(tipos({ objetivo: 'OUTCOME_TRAFFIC', dos: { inv: 120000, leads: 0 }, ayer: { inv: 60000, leads: 0 } }) === '',
   'una campaña de tráfico no tiene por qué traer leads');
ok(tipos({ red: 'google', objetivo: '', dos: { inv: 120000, leads: 0 }, ayer: { inv: 60000, leads: 0 } }) === 'sin_leads', 'en Google aplica igual');

console.log('Fechas en hora de Colombia');
const d = dias(new Date('2026-10-03T03:00:00Z'));   // 2 de octubre, 10 p. m. en Bogotá
ok(d.ayer === '2026-10-01' && d.anteayer === '2026-09-30' && d.semanaHasta === '2026-09-29' && d.semanaDesde === '2026-09-23',
   'a las 10 p. m. del 2 de octubre, «ayer» es el 1 (no el 2 de UTC) y la semana termina antes de anteayer', JSON.stringify(d));

console.log(mal ? `\n${mal} fallo(s)\n` : '\nTodo en orden\n');
process.exit(mal ? 1 : 0);

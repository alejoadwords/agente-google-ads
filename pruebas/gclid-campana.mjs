// La campaña del lead que solo trae el clic: node pruebas/gclid-campana.mjs
//
// En la cuenta de Certain, 5 de 332 leads traían el `gclid` de un anuncio de
// Google y los 5 contaban como «sin campaña»: el cruce de la pantalla une por
// id o por nombre, y el clic no lo miraba nadie. La mitad azul, en cero.
//
// Se ejecuta el módulo real con una Google de mentira. Lo que se comprueba no
// es que llame bien, sino lo que acaba escrito en el lead.

import { resolverClics, pendientes, SIN_CAMPANA, DIAS_CLICK_VIEW, consultaDelDia, filasAClics } from '../api/_gclid.js';

const HOY = Date.parse('2026-09-23T12:00:00Z');
const haceDias = (n) => new Date(HOY - n * 864e5).toISOString();

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

const lead = (id, clic, extra = {}, dias = 1) => ({
  id, created_at: haceDias(dias),
  custom_fields: { 'Clic de anuncio': clic, 'Plataforma': 'Google', ...extra },
});

function montar(porDia) {
  const guardados = [];
  const preguntas = [];
  return {
    guardados, preguntas,
    consultarDia: async (dia) => { preguntas.push(dia); return porDia[dia] || []; },
    guardar: async (id, campos) => { guardados.push({ id, campos }); },
  };
}

// ── A quién se le pregunta ──────────────────────────────────────────────────
console.log('\nSolo se pregunta por lo que hace falta\n');
{
  const ls = [
    lead('a', 'GCL-1'),
    lead('b', 'GCL-2', { 'ID de campaña': '999' }),          // ya atribuido
    lead('c', 'GCL-3', { 'Campaña': 'Search - general' }),   // por nombre
    lead('d', 'FB-1', { 'Plataforma': 'Meta' }),             // clic de Meta
    lead('e', 'GCL-5', { [SIN_CAMPANA]: true }),             // ya se preguntó
    { id: 'f', created_at: haceDias(1), custom_fields: {} },  // sin clic
  ];
  const p = pendientes(ls).map(l => l.id);
  chk('solo el que trae clic de Google y no tiene campaña', JSON.stringify(p) === '["a"]', JSON.stringify(p));
}

// ── El caso que motivó todo ─────────────────────────────────────────────────
console.log('\nEl lead que solo traía el clic acaba con su campaña\n');
{
  const dia = haceDias(1).slice(0, 10);
  const m = montar({ [dia]: [{ gclid: 'GCL-1', campaignId: '777', campaignName: 'Search - general 2026' }] });
  const ls = [lead('a', 'GCL-1')];
  const c = await resolverClics({ ...m, leads: ls, ahora: HOY });

  chk('se resolvió uno', c.resueltos === 1, JSON.stringify(c));
  chk('el lead queda con el ID de campaña', ls[0].custom_fields['ID de campaña'] === '777');
  chk('y con el nombre', ls[0].custom_fields['Campaña'] === 'Search - general 2026');
  // Sin esto, el cliente vería el cambio solo al recargar: el cruce de ESTA
  // carga ya usa el objeto que tenemos delante.
  chk('se escribe en el objeto que se va a cruzar ahora', !pendientes(ls).length);
  chk('y se guarda en la base para no volver a preguntar', m.guardados[0]?.id === 'a');
}

// ── Lo que Google no conoce ─────────────────────────────────────────────────
console.log('\nUn clic que Google no conoce no se pregunta dos veces\n');
{
  const dia = haceDias(1).slice(0, 10);
  const m = montar({ [dia]: [] });
  const ls = [lead('a', 'GCL-X')];
  const c = await resolverClics({ ...m, leads: ls, ahora: HOY });
  chk('se cuenta como sin campaña', c.sin_campana === 1, JSON.stringify(c));
  chk('queda marcado', ls[0].custom_fields[SIN_CAMPANA] === true);
  chk('y ya no vuelve a estar pendiente', !pendientes(ls).length);
  // El dato que sí traía no se pierde por el camino.
  chk('conserva el clic original', ls[0].custom_fields['Clic de anuncio'] === 'GCL-X');
}

// ── Los dos límites de Google ───────────────────────────────────────────────
console.log('\nLos límites que impone Google\n');
{
  const m = montar({});
  const ls = [lead('viejo', 'GCL-9', {}, DIAS_CLICK_VIEW + 5)];
  const c = await resolverClics({ ...m, leads: ls, ahora: HOY });
  chk('más de 90 días: ni se pregunta', m.preguntas.length === 0, JSON.stringify(m.preguntas));
  chk('se cuenta aparte, no como «sin campaña»',
      c.fuera_de_ventana === 1 && c.sin_campana === 0, JSON.stringify(c));
  chk('se marca para no repetirlo en cada carga', !pendientes(ls).length);
}
{
  // Un día por consulta, y agrupados: tres leads del mismo día son UNA pregunta.
  const dia = haceDias(2).slice(0, 10);
  const m = montar({ [dia]: [
    { gclid: 'G1', campaignId: '1', campaignName: 'A' },
    { gclid: 'G2', campaignId: '2', campaignName: 'B' },
  ] });
  const ls = [lead('a', 'G1', {}, 2), lead('b', 'G2', {}, 2), lead('c', 'G3', {}, 2)];
  const c = await resolverClics({ ...m, leads: ls, ahora: HOY });
  chk('tres leads del mismo día → una sola pregunta', m.preguntas.length === 1, JSON.stringify(m.preguntas));
  chk('dos resueltos y uno sin campaña', c.resueltos === 2 && c.sin_campana === 1, JSON.stringify(c));
}
{
  // Una cuenta recién conectada puede traer meses: la pantalla no espera 90
  // llamadas. Lo que no entra se cuenta como pendiente y sale en la siguiente.
  const porDia = {}; const ls = [];
  for (let d = 1; d <= 15; d++) { ls.push(lead('l' + d, 'G' + d, {}, d)); porDia[haceDias(d).slice(0, 10)] = []; }
  const m = montar(porDia);
  const c = await resolverClics({ ...m, leads: ls, ahora: HOY, maxDias: 10 });
  chk('se consultan como mucho 10 días', m.preguntas.length === 10, String(m.preguntas.length));
  chk('los 5 restantes quedan pendientes, no perdidos', c.pendientes === 5, JSON.stringify(c));
  chk('se empieza por los días más recientes',
      m.preguntas[0] === haceDias(1).slice(0, 10), m.preguntas[0]);
}

// ── Que un fallo no marque nada ─────────────────────────────────────────────
console.log('\nSi Google no contesta, no se da nada por perdido\n');
{
  const ls = [lead('a', 'G1')];
  const c = await resolverClics({
    leads: ls, ahora: HOY,
    consultarDia: async () => { throw new Error('502'); },
    guardar: async () => {},
  });
  chk('no se marca como irresoluble', !ls[0].custom_fields[SIN_CAMPANA]);
  chk('sigue pendiente para la próxima carga', c.pendientes === 1 && pendientes(ls).length === 1, JSON.stringify(c));
}
{
  // Con dos cuentas de Google, la primera que no lo conoce NO puede cerrarle
  // la puerta a la segunda.
  const ls = [lead('a', 'G1')];
  const m1 = montar({ [haceDias(1).slice(0, 10)]: [] });
  await resolverClics({ ...m1, leads: ls, ahora: HOY, marcarSinCampana: false });
  chk('la primera cuenta no lo marca', !ls[0].custom_fields[SIN_CAMPANA]);
  chk('la segunda cuenta todavía lo ve', pendientes(ls).length === 1);
  const m2 = montar({ [haceDias(1).slice(0, 10)]: [{ gclid: 'G1', campaignId: '55', campaignName: 'De la otra cuenta' }] });
  await resolverClics({ ...m2, leads: ls, ahora: HOY, marcarSinCampana: true });
  chk('y lo resuelve', ls[0].custom_fields['ID de campaña'] === '55', JSON.stringify(ls[0].custom_fields));
}

// ── La consulta que se le manda a Google ────────────────────────────────────
console.log('\nLa consulta y la respuesta de Google\n');
{
  const q = consultaDelDia('2026-09-23');
  chk('pide gclid, id y nombre de campaña', /click_view\.gclid/.test(q) && /campaign\.id/.test(q) && /campaign\.name/.test(q));
  chk('con un día exacto, que es lo único que admite click_view', /segments\.date = '2026-09-23'/.test(q));
  const c = filasAClics([
    { clickView: { gclid: 'G1' }, campaign: { id: '7', name: 'X' } },
    { campaign: { id: '8', name: 'Y' } },   // fila sin gclid
  ]);
  chk('se aplana bien y se descarta lo que no trae clic',
      c.length === 1 && c[0].gclid === 'G1' && c[0].campaignId === '7', JSON.stringify(c));
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);

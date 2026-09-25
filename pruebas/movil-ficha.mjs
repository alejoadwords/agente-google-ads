// Las pestañas de la ficha: node pruebas/movil-ficha.mjs
//
// «Qué ha pasado» y «Qué falta» estaban ESCRITAS A MANO. Y la peor parte no
// era que fueran inventadas: era que metían el nombre REAL del contacto en un
// hecho falso —«Llamar a Isla Chen · 11:00» sobre una tarea que no existe—.
// El nombre verdadero le presta credibilidad a la mentira.
//
// Aquí se ejecuta el cargador de verdad contra respuestas de mentira.

import { readFileSync } from 'node:fs';
import { cargarFicha, aHito } from '../public/movil-datos.js';

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};
const guion = readFileSync(new URL('../public/movil-app.js', import.meta.url), 'utf8');
const codigo = guion.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

console.log('\nYa no hay hechos escritos a mano\n');
{
  // El nombre del contacto dentro de una tarea inventada. Si esto vuelve, la
  // ficha miente otra vez y con la credibilidad del dato real.
  chk('nadie inventa una tarea con el nombre del contacto',
      !/Llamar a '\+l\.nom/.test(codigo));
  // Acotado a las dos funciones de la ficha: «Visita AP-2231» también está en
  // los ejemplos de Reservas, y ahí es legítimo —solo se ven sin sesión—.
  // Señalarlo era ruido, y el ruido tapa el aviso de verdad.
  const iF = codigo.indexOf('function fichaFalta');
  const ficha = codigo.slice(iF, codigo.indexOf('\n}\n', iF))
    + codigo.slice(codigo.indexOf('function fichaPasado'),
                   codigo.indexOf('\n}', codigo.indexOf('function fichaPasado')));
  chk('ni una visita concreta', !/Visita AP-/.test(ficha));
  chk('ni una automatización en el paso 2 de 3', !/paso 2 de 3/.test(ficha));
  chk('ni una campaña abierta dos veces', !/abierta 2 veces/.test(ficha));
  // El barrido de verdad: ninguna fila escrita a mano en las dos pestañas.
  chk('ninguna fila de la ficha va escrita a mano',
      !/\[\['/.test(ficha), (ficha.match(/\[\['[^\]]{0,50}/) || [''])[0]);
  chk('y la lista de hitos de ejemplo ya no existe', !/var HITOS = \[/.test(codigo));
}

console.log('\nCada caja viaja por su cuenta\n');
{
  const ok = (o) => ({ ok: true, json: async () => o });
  const porRuta = (mapa) => async (ruta) => {
    for (const [k, v] of Object.entries(mapa)) if (ruta.startsWith(k)) return v;
    return { ok: false, status: 500, json: async () => ({}) };
  };

  const d = await cargarFicha(porRuta({
    '/api/lead-activities': ok({ activities: [
      { type: 'nota', content: 'Llamé y no contestó', created_at: '2026-09-20T10:00:00Z' },
      { type: 'creacion', content: 'Entró por el formulario', created_at: '2026-09-10T08:00:00Z' },
    ] }),
    '/api/agenda': ok({ actividades: [
      { id: 't1', type: 'task', title: 'Llamar', due_at: '2026-09-30T15:00:00Z' },
      { id: 'm1', type: 'meeting', title: 'Visita', due_at: '2026-09-28T14:00:00Z' },
    ] }),
    '/api/automations': ok({ pendientes: [{ nombre: 'Seguimiento' }], hechas: [] }),
    '/api/campaigns': ok({ envios: [{ name: 'Octubre', sent_at: '2026-09-01T10:00:00Z' }] }),
    '/api/nps': ok({ encuesta: { nota: 9, comentario: 'Excelente' } }),
    '/api/proposals': ok({ proposals: [{ title: 'Penthouse', status: 'sent' }] }),
    '/api/chat-conversations': ok({ conversations: [{ id: 'c1', channel: 'whatsapp', status: 'human' }] }),
  }), 'L1');

  chk('el historial llega ordenado, lo último primero',
      d.hitos.length === 2 && /Llamé y no contestó/.test(d.hitos[0].que), JSON.stringify(d.hitos[0]));
  chk('y cada hito dice de qué tipo es', /^Nota: /.test(d.hitos[0].que), d.hitos[0].que);
  // La agenda devuelve tareas Y citas juntas: mezclarlas convertía una reserva
  // del propio cliente en un pendiente que alguien se apuntó.
  chk('las tareas y las citas vienen separadas',
      d.tareas.length === 1 && d.citas.length === 1, JSON.stringify([d.tareas.length, d.citas.length]));
  chk('la automatización en curso llega', d.autos.pendientes.length === 1);
  chk('la campaña también', d.campanas.length === 1);
  chk('la encuesta con su nota', d.nps && d.nps.nota === 9);
  chk('la propuesta', d.props.length === 1);
  chk('y la conversación', d.convs.length === 1 && d.convs[0].canal === 'whatsapp');
}

console.log('\nQue falle una caja no apaga las demás\n');
{
  const ok = (o) => ({ ok: true, json: async () => o });
  // Lo que más pasa: un endpoint de un módulo que la cuenta no usa devuelve
  // error, y con un Promise.all mal puesto se lleva la ficha entera.
  const d = await cargarFicha(async (ruta) => {
    if (ruta.startsWith('/api/campaigns')) return { ok: false, status: 500, json: async () => ({}) };
    if (ruta.startsWith('/api/lead-activities')) return ok({ activities: [{ type: 'nota', content: 'Hola', created_at: '2026-09-20T10:00:00Z' }] });
    return ok({});
  }, 'L1');
  chk('lo que sí llegó se conserva', d.hitos && d.hitos.length === 1, JSON.stringify(d.hitos));
  chk('y lo que falló viene null, no vacío', d.campanas === null, JSON.stringify(d.campanas));

  const muerto = await cargarFicha(async () => { throw new Error('sin red'); }, 'L1');
  chk('sin red devuelve nulls, no lanza', muerto.hitos === null && muerto.tareas === null);
}

console.log('\nLa pantalla distingue los tres casos\n');
{
  const i = codigo.indexOf('function fichaPasado');
  const fn = codigo.slice(i, codigo.indexOf('\n}', i));
  chk('mientras carga lo dice', /Trayendo su historial/.test(fn));
  chk('si falló lo dice', /No se pudo traer su historial/.test(fn));
  chk('y si de verdad no hay nada, también', /Todavía no hay nada registrado/.test(fn));
  chk('sin sesión no se queda colgado', /Entra con tu cuenta/.test(fn));

  const j = codigo.indexOf('function fichaFalta');
  const ff = codigo.slice(j, codigo.indexOf('\n}\n', j));
  chk('cada caja separa «no se pudo» de «no hay»', /No se pudo traer\./.test(ff), ff.slice(0, 200));
  // Se pide UNA vez por contacto: sin esto, cambiar de pestaña dispara siete
  // peticiones cada vez.
  chk('se pide una vez por contacto', /FICHA_CACHE\[l\.id\] !== undefined/.test(codigo));
  // Y la ficha pudo cerrarse mientras los datos viajaban.
  chk('no se pinta sobre otro contacto', /leadAbierto\.id === quien/.test(codigo));
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);

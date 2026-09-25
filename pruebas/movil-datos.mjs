// El puente entre la API y el móvil: node pruebas/movil-datos.mjs
//
// El mapeo es donde se esconden los fallos que nadie ve: un campo que se llama
// distinto y sale vacío, un cero que se lee como «vale cero» cuando significa
// «nadie lo puso», una lista vacía que dice «no hay» cuando lo que pasó fue
// que se cayó la consulta.
//
// Nada de esto rompe la pantalla. Solo la hace mentir.

import {
  aLead, aTarea, aCita, aConversacion, esCita, hace, plata,
  etiquetaEtapa, cargarTodo, diaSuelto,
} from '../public/movil-datos.js';

const AHORA = Date.parse('2026-09-24T12:00:00Z');
let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

console.log('\nUn cero no es lo mismo que un vacío\n');
{
  // «$ 0» se lee como «este negocio vale cero». Que nadie haya puesto el
  // importe es otra cosa, y la ficha ya sabe pintar «Sin dato».
  chk('sin valor devuelve vacío, no "$ 0"', plata(0) === '' && plata(null) === '' && plata(undefined) === '');
  chk('con valor lo formatea en pesos', plata(320000000) === '$ 320.000.000', plata(320000000));
  chk('un texto que no es número no inventa nada', plata('abc') === '');
}

console.log('\nEl lead trae lo que la ficha necesita\n');
{
  const l = aLead({
    id: 'a1', name: 'Hellen Marún', stage: 'contactado', source: 'web',
    phone: '+57 300', email: 'h@x.co', company: 'Acme', value: 320000000,
    assigned_name: 'Karen', tags: ['arriendo'], notes: 'Apto 2 hab',
    expected_close_date: '2026-09-30',
    custom_fields: { 'Campaña': 'Search 2026', 'Página': 'Arriendos' },
    created_at: '2026-09-01T12:00:00Z', updated_at: '2026-09-24T10:00:00Z',
  }, AHORA);
  chk('nombre, etapa y fuente', l.nom === 'Hellen Marún' && l.etapa === 'contactado' && l.origen === 'web');
  chk('los campos de pauta salen de custom_fields',
      l.campana === 'Search 2026' && l.pagina === 'Arriendos', l.campana);
  chk('el valor va formateado', l.valor === '$ 320.000.000', l.valor);
  // Una fecha sin hora interpretada en UTC retrocede un día en Colombia: el
  // cierre del 30 se pintaba «29 de sept». Adelanta TODOS los cierres un día.
  chk('la fecha de cierre no retrocede un día', /30/.test(l.cierre), l.cierre);
  // Todo lo de inactividad en la aplicación cuelga de updated_at. Usar otro
  // campo aquí haría que el móvil y el Pulso dijeran cosas distintas.
  chk('«hace» se cuenta desde updated_at, no desde created_at',
      l.hace === 'hace 2 h', l.hace);
}
{
  // Un lead recién creado a mano casi no trae nada. No puede reventar ni
  // inventarse valores.
  const l = aLead({ id: 'b2' }, AHORA);
  chk('un lead casi vacío no revienta', l.nom === 'Sin nombre' && l.etapa === 'nuevo');
  chk('y sus huecos quedan vacíos, no en "undefined"',
      l.valor === '' && l.campana === '' && l.cierre === '' && l.empresa === '',
      JSON.stringify([l.valor, l.campana, l.cierre, l.empresa]));
  chk('sin responsable se dice, no se deja en blanco', l.resp === 'Sin asignar');
  chk('las etiquetas son siempre una lista', Array.isArray(l.tags));
}

console.log('\nUna cita no es una tarea\n');
{
  chk('se distinguen por type', esCita({ type: 'meeting' }) && !esCita({ type: 'task' }));
  chk('y un nulo no cuela', !esCita(null) && !esCita(undefined));
}

console.log('\nVencida, hoy o próxima\n');
{
  const t = (due) => aTarea({ id: 'x', title: 'T', due_at: due }, AHORA).cuando;
  chk('ayer es vencida', t('2026-09-23T10:00:00Z') === 'vencida', t('2026-09-23T10:00:00Z'));
  chk('hoy es hoy', t('2026-09-24T18:00:00Z') === 'hoy', t('2026-09-24T18:00:00Z'));
  chk('mañana es próxima', t('2026-09-25T09:00:00Z') === 'proxima', t('2026-09-25T09:00:00Z'));
  // Nadie incumplió una tarea que no tenía fecha: pintarla en rojo es acusar
  // de un retraso que no existe.
  chk('sin fecha NO es vencida', t(null) === 'proxima', t(null));
  chk('y se dice «Sin fecha» en vez de inventar una',
      aTarea({ id: 'x', title: 'T' }, AHORA).s === 'Sin fecha');
}

console.log('\nLa ventana de 24 h se cuenta desde el cliente\n');
{
  const c = aConversacion({
    id: 'c1', contact_name: 'Ana', channel: 'whatsapp', status: 'bot',
    unread_count: 2, last_message: 'Hola', last_message_at: '2026-09-24T11:00:00Z',
    last_inbound_at: '2026-09-24T09:00:00Z',
  }, AHORA);
  chk('las horas salen de last_inbound_at', c.horas === 3, String(c.horas));
  chk('no leídas y vista previa', c.nolei === 2 && c.prev === 'Hola');
  chk('quién la atiende', c.quien === 'bot');
  // 'resolved' se colapsaba a 'human'. Desde que la hoja de estado deja elegir
  // «Resuelta», eso significaba que al reabrir la conversación la marca había
  // saltado sola a «Lo atiendo yo»: la pantalla contradiciendo lo que acabas
  // de guardar.
  chk('«resuelta» no se convierte en «la atiendo yo»',
      aConversacion({ id: 'r1', status: 'resolved' }, AHORA).quien === 'resolved',
      aConversacion({ id: 'r1', status: 'resolved' }, AHORA).quien);
  // Un estado que no conocemos NO puede caer en 'bot': eso dejaría al agente
  // respondiendo por su cuenta sin que nadie lo haya decidido.
  chk('un estado desconocido cae del lado seguro, no en el agente',
      aConversacion({ id: 'r2', status: 'loquesea' }, AHORA).quien === 'human');
  // Si se contara desde el último mensaje a secas, escribirle nosotros
  // reiniciaría la ventana y el aviso diría que se puede escribir cuando no.
  const d = aConversacion({
    id: 'c2', channel: 'whatsapp', status: 'human',
    last_message_at: '2026-09-24T11:00:00Z', last_inbound_at: '2026-09-22T09:00:00Z',
  }, AHORA);
  chk('escribir nosotros NO reinicia la ventana', d.horas > 24, String(d.horas));
  // Sin dato, se asume fuera: es el lado seguro. Decir que se puede escribir
  // y que el mensaje no llegue es peor que pedir una plantilla de más.
  chk('sin last_inbound_at se asume fuera de la ventana',
      aConversacion({ id: 'c3' }, AHORA).horas > 24);
  chk('sin nombre cae al teléfono antes que a «Sin nombre»',
      aConversacion({ id: 'c4', contact_phone: '+57 300' }, AHORA).nom === '+57 300');
}

console.log('\n«No hay» y «no se pudo mirar» son distintos\n');
{
  // Devolver [] cuando la consulta falló hace que la pantalla afirme que el
  // asesor no tiene tareas. Es la mentira más fácil de construir sin querer.
  const caido = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const r = await cargarTodo(caido);
  chk('si falla, viene null y no una lista vacía',
      r.leads === null && r.tareas === null && r.convs === null,
      JSON.stringify(r));

  const vacio = async () => ({ ok: true, json: async () => ({ leads: [], actividades: [], conversations: [] }) });
  const v = await cargarTodo(vacio);
  chk('si de verdad no hay, viene lista vacía',
      Array.isArray(v.leads) && v.leads.length === 0 && Array.isArray(v.tareas),
      JSON.stringify(v));

  // Una caída de red tampoco puede tumbar la carga entera.
  const explota = async () => { throw new Error('sin red'); };
  const e = await cargarTodo(explota);
  chk('un error de red devuelve null, no lanza', e.leads === null);
}
{
  // Que una consulta falle no puede apagar las que sí funcionaron.
  const mixto = async (ruta) => ruta.startsWith('/api/leads')
    ? { ok: false, json: async () => ({}) }
    : { ok: true, json: async () => ({ actividades: [], conversations: [] }) };
  const r = await cargarTodo(mixto);
  chk('lo que sí llegó se conserva aunque otra falle',
      r.leads === null && Array.isArray(r.tareas), JSON.stringify(r));
}

console.log('\nUna fecha sin hora no puede viajar en el tiempo\n');
{
  chk('el 30 es el 30', /30/.test(diaSuelto('2026-09-30')), diaSuelto('2026-09-30'));
  chk('el 1 de enero no se vuelve 31 de diciembre',
      /1/.test(diaSuelto('2026-01-01')) && !/dic/.test(diaSuelto('2026-01-01')), diaSuelto('2026-01-01'));
  chk('una marca completa con hora también vale', /15/.test(diaSuelto('2026-03-15T10:00:00Z')));
  chk('vacío o basura no inventan fecha', diaSuelto(null) === '' && diaSuelto('hola') === '');
}

console.log('\nDetalles que se leen de un vistazo\n');
{
  chk('menos de un minuto es «ahora»', hace('2026-09-24T11:59:50Z', AHORA) === 'ahora');
  chk('un día es «ayer»', hace('2026-09-23T11:00:00Z', AHORA) === 'ayer', hace('2026-09-23T11:00:00Z', AHORA));
  chk('sin fecha no inventa nada', hace(null) === '' && hace('no es fecha') === '');
  chk('las etapas fijas tienen su etiqueta', etiquetaEtapa('ganado') === 'Ganado');
  // Las etapas las pone cada cuenta: la del cliente manda sobre la del catálogo.
  chk('una etapa propia de la cuenta gana',
      etiquetaEtapa('nuevo', [{ key: 'nuevo', label: 'Cliente recibido' }]) === 'Cliente recibido');
  chk('una etapa desconocida se muestra tal cual', etiquetaEtapa('rarita') === 'rarita');
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);

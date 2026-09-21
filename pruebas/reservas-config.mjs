// La configuración de reservas: node pruebas/reservas-config.mjs
//
// Lo que se prueba aquí no es «que guarde», sino las dos formas en que esto
// falla CALLADO: un horario mal formado que deja la página pública sin horas, y
// un filtro de cliente que devuelve la lista vacía en vez de dar error.

import { readFileSync } from 'node:fs';
import { limpiarHorario, limpiarExcepciones } from '../api/bookings.js';

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('\nEl horario semanal\n');
{
  chk('un horario normal pasa entero',
      igual(limpiarHorario({ 1: [['09:00', '13:00'], ['14:00', '18:00']] }),
            { 1: [['09:00', '13:00'], ['14:00', '18:00']] }));
  chk('los tramos salen ordenados por hora de apertura',
      igual(limpiarHorario({ 3: [['14:00', '18:00'], ['09:00', '13:00']] })[3],
            [['09:00', '13:00'], ['14:00', '18:00']]));
  chk('un tramo al revés se cae', igual(limpiarHorario({ 2: [['18:00', '09:00']] }), {}));
  chk('una hora inventada se cae', igual(limpiarHorario({ 2: [['25:00', '26:00']] }), {}));
  chk('«9:00» sin cero delante se cae', igual(limpiarHorario({ 2: [['9:00', '13:00']] }), {}));
  chk('un tramo a medias se cae', igual(limpiarHorario({ 2: [['09:00']] }), {}));
  chk('los días fuera de 0..6 no entran', igual(limpiarHorario({ 9: [['09:00', '13:00']] }), {}));
  chk('las claves valen como número o como texto',
      igual(limpiarHorario({ '5': [['09:00', '13:00']] }), { 5: [['09:00', '13:00']] }));
  chk('lo que no es un objeto se rechaza, no se convierte en {}',
      limpiarHorario(null) === null && limpiarHorario('lunes') === null);
  chk('un horario vacío es {} y no null: significa cerrado siempre',
      igual(limpiarHorario({}), {}));
}

console.log('\nLos días especiales\n');
{
  // Esta es la distinción que sostiene los festivos. Si la lista vacía se
  // perdiera, un 25 de diciembre marcado como cerrado volvería a abrir solo.
  chk('una lista vacía SOBREVIVE: es «ese día cerramos»',
      igual(limpiarExcepciones({ '2026-12-25': [] }), { '2026-12-25': [] }));
  chk('y un día con horario propio manda sobre el semanal',
      igual(limpiarExcepciones({ '2026-12-24': [['09:00', '13:00']] }),
            { '2026-12-24': [['09:00', '13:00']] }));
  chk('una fecha mal escrita no entra',
      igual(limpiarExcepciones({ '25-12-2026': [] }), {}));
  chk('un valor que no es lista se ignora entero',
      igual(limpiarExcepciones({ '2026-12-25': 'cerrado' }), {}));
  chk('los tramos malos de un día se caen pero el día se queda cerrado',
      igual(limpiarExcepciones({ '2026-12-25': [['zzz', 'xxx']] }), { '2026-12-25': [] }));
}

console.log('\nEl filtro de cliente, tabla por tabla\n');
{
  // En PostgREST `client_id=eq.` NO casa con NULL. Servicios y recursos guardan
  // NULL cuando la reserva es de la cuenta; booking_settings guarda '' porque su
  // columna es NOT NULL y forma parte de la clave. Usar el filtro cruzado no da
  // error: devuelve CERO filas, y el catálogo entero desaparece sin un mensaje.
  const src = readFileSync(new URL('../api/bookings.js', import.meta.url), 'utf8');
  const lineas = src.split('\n');

  const conFiltro = lineas
    .map((l, i) => ({ n: i + 1, l }))
    .filter(x => /filtroCliente\(|filtroConfig\(/.test(x.l) && !/^const filtro/.test(x.l.trim()));

  chk('hay líneas que filtran por cliente', conFiltro.length >= 4, String(conFiltro.length));

  const malas = conFiltro.filter(x =>
    (/booking_settings/.test(x.l) && /filtroCliente\(/.test(x.l)) ||
    (/booking_services|booking_resources/.test(x.l) && /filtroConfig\(/.test(x.l)));
  chk('ninguna tabla usa el filtro de la otra',
      malas.length === 0, malas.map(x => 'línea ' + x.n).join(', '));

  chk('sin cliente, servicios y recursos preguntan por NULL',
      /filtroCliente = \(cliente\) => \(cliente \?[\s\S]{0,120}client_id=is\.null/.test(src));
  chk('y la configuración pregunta por la cadena vacía',
      /filtroConfig = \(cliente\) => `client_id=eq\.\$\{encodeURIComponent\(cliente \|\| ''\)\}`/.test(src));

  // `mia()` se usa para las dos tablas de catálogo, nunca para la configuración.
  chk('la comprobación de propiedad solo se usa con las tablas de catálogo',
      !/mia\('booking_settings'/.test(src));
}

console.log('\nCosas que no se pueden perder\n');
{
  const src = readFileSync(new URL('../api/bookings.js', import.meta.url), 'utf8');
  chk('el upsert de la configuración lleva on_conflict',
      /booking_settings\?on_conflict=user_id,client_id/.test(src));
  chk('la página nace APAGADA', /activo: false/.test(src));
  chk('el token solo se regenera si lo piden a propósito',
      /body\.regenerar_token === true/.test(src));
  chk('un recurso solo se puede enganchar a alguien del propio equipo',
      /team_members\?owner_user_id=eq/.test(src));
  chk('cambiar la configuración exige perfil administrador',
      /esAdmin && req\.method !== 'GET'/.test(src));
  chk('un miembro acotado no puede pedir otro cliente',
      /clienteAjeno\(quien, pedido\)/.test(src));
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);

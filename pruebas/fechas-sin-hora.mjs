// Fechas sin hora: node pruebas/fechas-sin-hora.mjs
//
// Una fecha suelta —«2026-09-30», sin hora— la interpreta `new Date()` como
// medianoche UTC. En Colombia eso son las 19:00 del día ANTERIOR. Formatearla
// la retrasa un día; compararla la adelanta cinco horas.
//
// No falla nada. Solo mueve fechas, y nadie lo nota hasta que alguien llama
// tarde o se reserva un día que el negocio no ofrecía.
//
// Esta prueba es el barrido: vigila los sitios donde el proyecto maneja días
// sueltos, para que el patrón no vuelva a entrar.

import { readFileSync } from 'node:fs';

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};
const leer = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

console.log('\nEl móvil pinta el día que dice la base\n');
{
  const { diaSuelto, aLead } = await import('../public/movil-datos.js');
  chk('el 30 se pinta 30', /30/.test(diaSuelto('2026-09-30')), diaSuelto('2026-09-30'));
  // El caso que más duele: un cierre del 1 de enero reportado el 31 de
  // diciembre cae en el informe del año anterior.
  chk('el 1 de enero no cae en diciembre',
      !/dic/.test(diaSuelto('2026-01-01')), diaSuelto('2026-01-01'));
  chk('la ficha usa el ayudante, no new Date()',
      /cierre: diaSuelto\(/.test(leer('public/movil-datos.js')));
  chk('un lead sin fecha de cierre no inventa una',
      aLead({ id: 'x' }).cierre === '');
}

console.log('\nLa ventana de reservas no depende de la hora\n');
{
  const s = leer('api/booking-public.js');
  // `d.dia` es un día local del negocio. Medirlo con `new Date()` lo adelanta
  // cinco horas y ofrece un día de más según cuándo se abra la página.
  chk('el tope es un día local, no un instante', /const topeDia = diaLocal\(zona, tope\)/.test(s));
  // Sin quitar los comentarios, esta aserción se chocaba con el comentario
  // que explica el fallo: lo que importa es que no quede en el CÓDIGO.
  const codigo = s.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  chk('se comparan dos días, no un día contra una fecha',
      /d\.dia <= topeDia/.test(codigo) && !/new Date\(d\.dia\)/.test(codigo));
}

console.log('\nLa tarea del móvil también pide hora\n');
{
  const guion = leer('public/movil-app.js');
  // El servidor exige hora Y zona. Un `type="date"` daría un día suelto, el
  // servidor no lo reconocería y la tarea NO se crearía — en silencio.
  chk('el campo es datetime-local, no date',
      /id="sh-cuando" type="datetime-local"/.test(guion),
      (guion.match(/id="sh-cuando" type="[a-z-]+"/) || [''])[0]);
  // Los atajos —«Mañana 9:00»— se escriben en hora LOCAL. Con toISOString()
  // el campo saldría en UTC y la tarea quedaría cinco horas corrida.
  chk('los atajos rellenan el campo en hora local',
      /function paraInput\(d\)[\s\S]{0,260}getFullYear\(\)/.test(guion));
  chk('y no con toISOString, que lo pasaría a UTC',
      !/paraInput[\s\S]{0,200}toISOString/.test(guion));
  // Pero al ENVIARLA sí va en UTC, que es lo que el servidor espera.
  chk('al enviarla sí va en UTC', /due_at: fecha\.toISOString\(\)/.test(guion));
}

console.log('\nLos sitios que ya lo hacían bien siguen así\n');
{
  const app = leer('public/app.js');
  // La fecha de cierre en la tarjeta se parte a mano en vez de pasar por
  // new Date(). Si alguien lo "simplifica", vuelve el fallo.
  chk('el chip de cierre parte la fecha a mano',
      /const \[a, m, d\] = f\.split\('-'\)/.test(app));
  // Los filtros comparan cadenas de día entre sí, que es lo correcto.
  chk('los filtros de cierre comparan cadenas',
      /l\.expected_close_date >= crmFechaCierreDesde/.test(app));
  // El campo de la tarea lleva hora, y por eso new Date() sí vale ahí. Si
  // alguien lo cambia a `type="date"`, el valor pasa a ser un día suelto: el
  // servidor deja de reconocerlo y NO crea la tarea real.
  chk('la fecha límite de una tarea pide hora (datetime-local)',
      /<input type="datetime-local" id="crm-act-due"/.test(leer('public/index.html')));
  // El servidor exige hora y zona explícitas antes de crear la tarea.
  chk('el servidor valida la forma antes de crear la tarea',
      /sinZona \? new Date\(txt \+ ':00-05:00'\)/.test(leer('api/lead-activities.js')));
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);

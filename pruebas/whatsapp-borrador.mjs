// Escribir una plantilla: node pruebas/whatsapp-borrador.mjs
//
// Meta tarda días en revisar y sus rechazos llegan con un motivo genérico. Casi
// todos los que se pueden evitar se ven antes de enviar, así que esta prueba
// cubre exactamente eso: lo que la validación tiene que atrapar aquí para que
// el cliente no lo descubra el jueves.

import { revisarBorrador, componentesDe, huecosDe, LIMITES } from '../api/_whatsapp.js';

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

const base = {
  name: 'promo_septiembre', category: 'MARKETING', language: 'es',
  body: 'Hola {{1}}, en {{2}} tenemos una promoción para ti este mes. Escríbenos y te contamos.',
  ejemplos_body: ['María', 'Seguros del Norte'],
};
const con = (x) => ({ ...base, ...x });
const errs = (x) => revisarBorrador(con(x)).errores;
const avs = (x) => revisarBorrador(con(x)).avisos;

console.log('\nUna plantilla correcta\n');
{
  const r = revisarBorrador(base);
  chk('pasa sin errores', r.errores.length === 0, r.errores.join(' · '));
  chk('y sin avisos', r.avisos.length === 0, r.avisos.join(' · '));
}

console.log('\nEl nombre\n');
{
  chk('rechaza mayúsculas y espacios', errs({ name: 'Promo Septiembre' }).length === 1);
  chk('rechaza tildes', errs({ name: 'promoción' }).length === 1);
  chk('exige que haya nombre', errs({ name: '' }).length >= 1);
  chk('acepta guiones bajos y números', errs({ name: 'promo_2026_v2' }).length === 0);
}

console.log('\nLa categoría\n');
{
  chk('exige marketing o utilidad', errs({ category: 'AUTHENTICATION' }).length === 1);
  chk('acepta utilidad', errs({ category: 'UTILITY', body: 'Hola {{1}}, tu cita quedó confirmada para el {{2}}.' }).length === 0);
}

console.log('\nLos huecos y sus ejemplos\n');
{
  chk('sin ejemplos no deja enviar (el rechazo más común de Meta)',
      errs({ ejemplos_body: [] }).some(e => /ejemplos/i.test(e)));
  chk('con ejemplos de menos tampoco', errs({ ejemplos_body: ['María'] }).some(e => /ejemplos/i.test(e)));
  chk('y con un solo hueco lo dice en singular',
      errs({ body: 'Hola {{1}}, te escribimos por lo que hablamos.', ejemplos_body: [] })
        .some(e => /Falta el ejemplo del hueco del mensaje/.test(e)));
  chk('los huecos salteados se rechazan: {{1}} y {{3}}',
      errs({ body: 'Hola {{1}}, mira esto {{3}} por favor.', ejemplos_body: ['a', 'b', 'c'] })
        .some(e => /numerados/i.test(e)));
  chk('un hueco repetido no cuenta dos veces',
      errs({ body: 'Hola {{1}}, {{1}} te esperamos aquí.', ejemplos_body: ['María'] }).length === 0);
  chk('el título admite un solo hueco',
      errs({ header: '{{1}} y {{2}}', ejemplos_header: ['a', 'b'] }).some(e => /un solo hueco/i.test(e)));
  chk('el pie no admite huecos',
      errs({ footer: 'Escribe a {{1}}' }).some(e => /pie no admite/i.test(e)));
}

console.log('\nLos límites de Meta\n');
{
  chk(`el mensaje corta en ${LIMITES.body}`, errs({ body: 'a'.repeat(LIMITES.body + 1), ejemplos_body: [] }).some(e => /mensaje pasa/i.test(e)));
  chk(`el título corta en ${LIMITES.header}`, errs({ header: 'a'.repeat(LIMITES.header + 1) }).some(e => /título pasa/i.test(e)));
  chk(`el pie corta en ${LIMITES.footer}`, errs({ footer: 'a'.repeat(LIMITES.footer + 1) }).some(e => /pie pasa/i.test(e)));
  chk('el mensaje vacío se rechaza', errs({ body: '' }).some(e => /vacío/i.test(e)));
}

console.log('\nLos avisos: motivos de rechazo frecuentes\n');
{
  chk('avisa si el mensaje empieza con un hueco',
      avs({ body: '{{1}}, tenemos algo para ti este mes en la tienda.', ejemplos_body: ['María'] })
        .some(a => /empiezan o terminan/i.test(a)));
  chk('avisa si termina con un hueco',
      avs({ body: 'Te esperamos en {{1}}', ejemplos_body: ['Bogotá'] })
        .some(a => /empiezan o terminan/i.test(a)));
  chk('avisa si hay poco texto propio para tantos huecos',
      avs({ body: '{{1}} {{2}} {{3}}.', ejemplos_body: ['a', 'b', 'c'] })
        .some(a => /genérica/i.test(a)));
  chk('avisa si la categoría no cuadra con el texto',
      avs({ category: 'UTILITY' }).some(a => /recategoriza/i.test(a)));
  chk('pero un aviso NO impide enviar',
      errs({ body: 'Te esperamos en {{1}}', ejemplos_body: ['Bogotá'] }).length === 0);
}

console.log('\nLo que se le manda a Meta\n');
{
  const c = componentesDe(con({ header: 'Novedades de {{1}}', ejemplos_header: ['septiembre'], footer: 'Responde STOP para salir' }));
  const tipo = (t) => c.find(x => x.type === t);
  chk('lleva título, cuerpo y pie', !!tipo('HEADER') && !!tipo('BODY') && !!tipo('FOOTER'));
  chk('el título va como TEXT', tipo('HEADER').format === 'TEXT');
  chk('el ejemplo del título es un arreglo PLANO',
      Array.isArray(tipo('HEADER').example.header_text) && tipo('HEADER').example.header_text[0] === 'septiembre');
  chk('el del cuerpo es un arreglo DE arreglos (Meta los pide distintos)',
      Array.isArray(tipo('BODY').example.body_text[0]) && tipo('BODY').example.body_text[0][1] === 'Seguros del Norte');
  chk('el pie no lleva ejemplo', !tipo('FOOTER').example);
  chk('el cuerpo siempre va, aunque no haya título',
      componentesDe({ body: 'Hola' }).some(x => x.type === 'BODY'));
  chk('sin huecos no se manda ejemplo', !componentesDe({ body: 'Hola' })[0].example);
}

console.log('\nEl botón de enlace\n');
{
  const c = componentesDe(con({ boton: { text: 'Ver catálogo', url: 'https://ejemplo.com/promo' } }));
  const b = c.find(x => x.type === 'BUTTONS');
  chk('se añade cuando tiene texto y URL', !!b && b.buttons[0].type === 'URL');
  chk('con su texto y su enlace', b.buttons[0].text === 'Ver catálogo' && /ejemplo\.com/.test(b.buttons[0].url));
  chk('sin URL válida no se añade',
      !componentesDe(con({ boton: { text: 'Ver', url: 'ejemplo.com' } })).some(x => x.type === 'BUTTONS'));
  chk('sin botón no aparece la sección', !componentesDe(base).some(x => x.type === 'BUTTONS'));
}

console.log('\nLos dos caminos de conexión guardan el waba_id\n');
{
  const { readFileSync } = await import('node:fs');
  const lee = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  // Sin waba_id no hay plantillas. Que UN camino lo guarde y el otro no es
  // justo como la funcion quedo inalcanzable para quien podia usarla.
  chk('el alta por Meta (registro insertado) lo guarda',
      /waba_id: String\(waba_id\)/.test(lee('api/whatsapp-onboard.js')));
  chk('y al reconectar por ahi tambien lo refresca',
      /waba_id: fila\.waba_id/.test(lee('api/whatsapp-onboard.js')));
  chk('el alta manual (token propio) lo acepta',
      /channel === 'whatsapp' && body\.waba_id/.test(lee('api/channel-connections.js')));
  const front = lee('public/app.js');
  chk('el formulario manual lo pide', /wa-f-waba-id/.test(front));
  chk('lo exige antes de guardar', /El WhatsApp Business Account ID es obligatorio/.test(front));
  chk('y lo valida contra Meta, no solo el telefono',
      /\$\{wabaId\}\?fields=name&access_token=/.test(front));
  chk('y lo manda al servidor', /waba_id: wabaId/.test(front));
}

console.log('\nCabecera con imagen\n');
{
  const conImg = con({ header_format: 'IMAGE', header_image: 'https://cdn/x.jpg', header: '', ejemplos_header: [] });
  chk('con imagen y archivo, sin errores', revisarBorrador(conImg).errores.length === 0,
      revisarBorrador(conImg).errores.join(' · '));
  chk('elegir imagen y no subir ninguna es error',
      revisarBorrador(con({ header_format: 'IMAGE' })).errores.some(e => /no has subido/i.test(e)));

  const c = componentesDe(conImg, 'HANDLE123');
  const h = c.find(x => x.type === 'HEADER');
  chk('el componente va como IMAGE', h && h.format === 'IMAGE');
  chk('y lleva el handle como ejemplo', h.example.header_handle[0] === 'HANDLE123');
  chk('sin texto: una cabecera es texto O imagen', !h.text);
  chk('el cuerpo y su ejemplo siguen intactos',
      c.find(x => x.type === 'BODY').example.body_text[0][1] === 'Seguros del Norte');
  chk('el pie y el botón se arman igual que con texto',
      componentesDe({ ...conImg, footer: 'Pie', boton: { text: 'Ver', url: 'https://x.co' } }, 'H')
        .filter(x => x.type === 'FOOTER' || x.type === 'BUTTONS').length === 2);
  chk('sin handle no se manda cabecera (Meta la rechazaria)',
      !componentesDe(conImg, null).some(x => x.type === 'HEADER'));

  // Si se eligio imagen, el texto del titulo no puede colarse
  const mixto = componentesDe(con({ header_format: 'IMAGE', header: 'Texto viejo' }), 'H');
  chk('un titulo de texto olvidado no se envia', !mixto.some(x => x.format === 'TEXT'));
}

console.log('\nLeer el formato de una plantilla que ya existe\n');
{
  chk('reconoce una cabecera de imagen',
      huecosDe([{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Hola' }]).header_format === 'IMAGE');
  chk('y una de texto', huecosDe([{ type: 'HEADER', format: 'TEXT', text: 'Hola {{1}}' }]).header_format === 'TEXT');
  chk('sin cabecera devuelve nulo', huecosDe([{ type: 'BODY', text: 'Hola' }]).header_format === null);
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);

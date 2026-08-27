// public/plantillas-base.js
// Diseños de arranque para el constructor de correos.
//
// Van en un archivo aparte y se piden solo al abrir el constructor: son texto
// pesado que no le sirve de nada a quien nunca hace una campaña, y app.js ya
// tiene 30.000 líneas.
//
// Reglas que cumplen todos, y no son capricho:
//   · TABLAS, no divs con flex. Outlook no entiende flexbox y descuadra todo.
//   · Ancho fijo de 600px, que es lo que cabe en la vista previa de Gmail.
//   · Estilos EN LÍNEA. Los clientes de correo tiran las hojas de estilo.
//   · Sin imágenes externas: una URL ajena que un día muera dejaría un hueco
//     roto en las plantillas de todo el mundo. Donde va una imagen hay un
//     hueco marcado para que el usuario suba la suya.
//   · Con variables reales ({{nombre}}, {{empresa}}) ya puestas de ejemplo.

window.PLANTILLAS_BASE = (function () {
  const AZUL = '#1E2BCC';
  const TINTA = '#1a1a2e';
  const GRIS = '#6b7280';

  // El hueco de imagen. Se ve como una banda gris con su instrucción dentro, y
  // al hacerle doble clic en el constructor se cambia por la de verdad.
  const hueco = (alto, texto) =>
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px">' +
    '<tr><td align="center" style="background:#eef0f5;border-radius:10px;height:' + alto + 'px;' +
    'color:#9aa1ad;font-family:Arial,Helvetica,sans-serif;font-size:12px;padding:' + Math.round(alto / 2.6) + 'px 16px">' +
    texto + '</td></tr></table>';

  const envolver = (dentro, fondo) =>
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + (fondo || '#f5f6fa') + ';padding:24px 12px">' +
    '<tr><td align="center">' +
    '<table width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:14px;padding:32px 30px;font-family:Arial,Helvetica,sans-serif">' +
    '<tr><td>' + dentro + '</td></tr></table></td></tr></table>';

  const h1 = t => '<h1 style="margin:0 0 14px;font-size:26px;line-height:1.25;color:' + TINTA + '">' + t + '</h1>';
  const p = t => '<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:' + TINTA + '">' + t + '</p>';
  const chico = t => '<p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:' + GRIS + '">' + t + '</p>';
  const boton = t => '<table cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 22px"><tr>' +
    '<td align="center" style="background:' + AZUL + ';border-radius:9px">' +
    '<a href="https://" style="display:inline-block;padding:13px 30px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;font-family:Arial,Helvetica,sans-serif">' + t + '</a>' +
    '</td></tr></table>';
  const raya = () => '<div style="border-top:1px solid #e8eaf0;margin:0 0 22px"></div>';
  const firma = () => chico('Un saludo,<br>El equipo de {{empresa}}');

  return [
    {
      id: 'bienvenida',
      nombre: 'Bienvenida',
      categoria: 'Primer contacto',
      descripcion: 'Para quien acaba de dejar sus datos. Presenta y propone el siguiente paso.',
      html: envolver(
        hueco(90, 'TU LOGO — doble clic para subirlo') +
        h1('Hola {{nombre}}, gracias por escribirnos') +
        p('Recibimos tu solicitud y ya estamos trabajando en ella. En menos de 24 horas alguien de nuestro equipo te contacta con una propuesta hecha a tu medida.') +
        p('Mientras tanto, si quieres adelantar, puedes agendar una llamada en el horario que mejor te venga.') +
        boton('Agendar una llamada') +
        raya() +
        firma()
      ),
    },
    {
      id: 'promocion',
      nombre: 'Promoción',
      categoria: 'Ventas',
      descripcion: 'Una oferta con imagen grande, precio y un solo botón.',
      html: envolver(
        hueco(220, 'IMAGEN DEL PRODUCTO — doble clic para subirla') +
        h1('{{nombre}}, esto te va a interesar') +
        p('Durante esta semana tenemos una condición especial para clientes como tú. Escribe aquí qué incluye, para quién es y hasta cuándo dura.') +
        '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px">' +
        '<tr><td align="center" style="background:#f0f1fe;border-radius:12px;padding:20px">' +
        '<div style="font-size:13px;color:' + GRIS + ';font-family:Arial,Helvetica,sans-serif">Precio especial</div>' +
        '<div style="font-size:32px;font-weight:bold;color:' + AZUL + ';font-family:Arial,Helvetica,sans-serif;margin-top:4px">$ 0.000.000</div>' +
        '</td></tr></table>' +
        boton('Lo quiero') +
        chico('La promoción termina el 00 de mes. Aplican condiciones.')
      ),
    },
    {
      id: 'seguimiento',
      nombre: 'Seguimiento',
      categoria: 'Reactivación',
      descripcion: 'Correo corto y personal para un lead que se enfrió. Sin imágenes.',
      html: envolver(
        p('Hola {{nombre}},') +
        p('Te escribo porque hablamos hace un tiempo sobre lo de {{empresa}} y quedamos en que te confirmaría. No quiero dejarlo en el aire.') +
        p('¿Sigue siendo algo que estás mirando, o lo dejamos para más adelante? Con una línea me basta.') +
        boton('Retomar la conversación') +
        firma(),
        '#ffffff'
      ),
    },
    {
      id: 'novedades',
      nombre: 'Novedades',
      categoria: 'Contenido',
      descripcion: 'Boletín con tres bloques de noticias, cada uno con su imagen.',
      html: envolver(
        hueco(70, 'TU LOGO') +
        h1('Lo nuevo de este mes') +
        chico('Un resumen breve de lo que ha pasado y por qué le importa a {{nombre}}.') +
        raya() +
        hueco(140, 'IMAGEN 1') +
        '<h2 style="margin:0 0 8px;font-size:18px;color:' + TINTA + '">Primer titular</h2>' +
        chico('Dos o tres líneas contando de qué va. Que se entienda sin tener que abrir nada más.') +
        raya() +
        hueco(140, 'IMAGEN 2') +
        '<h2 style="margin:0 0 8px;font-size:18px;color:' + TINTA + '">Segundo titular</h2>' +
        chico('Otro bloque igual. Borra los que te sobren o duplica el que necesites.') +
        raya() +
        boton('Ver todo')
      ),
    },
    {
      id: 'evento',
      nombre: 'Invitación a evento',
      categoria: 'Eventos',
      descripcion: 'Fecha, lugar y confirmación de asistencia bien visibles.',
      html: envolver(
        hueco(180, 'IMAGEN DEL EVENTO') +
        h1('Te esperamos, {{nombre}}') +
        p('Queremos invitarte a un encuentro pensado para gente como tú. Cuenta aquí de qué va y qué se lleva quien asista.') +
        '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;border:1px solid #e8eaf0;border-radius:12px">' +
        '<tr><td style="padding:16px 18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:' + TINTA + '">' +
        '<strong>Cuándo:</strong> 00 de mes, 0:00 p. m.<br>' +
        '<strong>Dónde:</strong> Escribe la dirección o el enlace<br>' +
        '<strong>Cupo:</strong> Limitado' +
        '</td></tr></table>' +
        boton('Confirmar asistencia') +
        chico('Si no puedes asistir, respóndenos a este correo y te enviamos la grabación.')
      ),
    },
    {
      id: 'propuesta',
      nombre: 'Envío de propuesta',
      categoria: 'Ventas',
      descripcion: 'Acompaña una cotización: qué incluye, cuánto vale y qué sigue.',
      html: envolver(
        h1('Tu propuesta, {{nombre}}') +
        p('Como quedamos, aquí va la propuesta para {{empresa}}. La preparamos con lo que hablamos, así que si algo no encaja lo ajustamos sin problema.') +
        '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px">' +
        '<tr><td style="padding:12px 0;border-bottom:1px solid #e8eaf0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:' + TINTA + '">Primer punto de lo que incluye</td></tr>' +
        '<tr><td style="padding:12px 0;border-bottom:1px solid #e8eaf0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:' + TINTA + '">Segundo punto</td></tr>' +
        '<tr><td style="padding:12px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:' + TINTA + '">Tercer punto</td></tr>' +
        '</table>' +
        boton('Ver la propuesta') +
        chico('Cualquier duda, respóndeme a este mismo correo.') +
        firma()
      ),
    },
  ];
})();

// Retomar la conversación que se quedó a medias:
//   node pruebas/seguimiento-conversacion.mjs
//
// El agente responde, la persona se distrae, y el lead se pierde sin que nadie
// haya hecho nada mal. A los 10 minutos de silencio se retoma — y no con un
// «¿sigues ahí?», que no acerca nada, sino con la pregunta que FALTA para
// poder calificar a esa persona.
//
// Lo que más importa aquí es a quién NO se le escribe: una conversación que ya
// atiende una persona, una fuera de la ventana de WhatsApp, una a las tres de
// la mañana, o una cuya cuenta agotó el cupo.

import fs from 'fs';
for (const l of fs.readFileSync(process.argv[2] + '/.env', 'utf8').split('\n')) {
  const i = l.indexOf('='); if (i > 0) process.env[l.slice(0, i)] = l.slice(i + 1);
}
const { preguntaQueFalta, textoDeSeguimiento, enHorario } = await import('../api/cron-seguimiento.js');

const src = fs.readFileSync(new URL('../api/cron-seguimiento.js', import.meta.url), 'utf8');
const vercel = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + extra : ''));
  if (!c) mal++;
};

console.log('\nSe pregunta lo que falta, en el orden en que hace falta');
{
  // Sin teléfono no se puede llamar a nadie: es lo primero, siempre.
  ok(/número de contacto/.test(preguntaQueFalta({}, {})), 'sin nada, se pide el teléfono');
  ok(/número de contacto/.test(preguntaQueFalta({ nombre: 'Ana', zona: 'Riomar', presupuesto: '3000000' }, {})),
     'y con todo lo demás menos el teléfono, también');

  const conTel = { celular: '3001234567' };
  ok(/zona o barrio/.test(preguntaQueFalta(conTel, {})), 'con teléfono, se pregunta la zona');
  ok(/presupuesto/.test(preguntaQueFalta({ ...conTel, zona: 'Riomar' }, {})), 'con zona, el presupuesto');
  ok(/nombre/.test(preguntaQueFalta({ ...conTel, zona: 'Riomar', presupuesto: '3000000' }, {})),
     'y después el nombre');
  ok(/visita|asesor/.test(preguntaQueFalta({ ...conTel, zona: 'R', presupuesto: '1', nombre: 'Ana' }, {})),
     'con todo, se propone el paso siguiente');

  // Lo que ya está respondido en la calificación cuenta igual que lo capturado:
  // preguntar otra vez algo que la persona ya dijo es la forma más rápida de
  // que se note que hay una máquina detrás.
  const porCriterio = preguntaQueFalta(conTel, { zona: { valor: 'Buenavista', cumple: true } });
  ok(!/zona o barrio/.test(porCriterio), 'lo respondido en la calificación no se vuelve a preguntar', porCriterio);

  // Un valor vacío no es un valor.
  ok(/número de contacto/.test(preguntaQueFalta({ celular: '   ' }, {})), 'un dato en blanco no cuenta como dato');
}

console.log('\nY se respeta el trato del agente');
{
  ok(/le escriba|le interesa|su nombre|Quiere/.test(textoDeSeguimiento({}, {}, 'formal')), 'a un agente formal, de usted');
  ok(/te escriba|te interesa|tu nombre|Quieres/.test(textoDeSeguimiento({}, {}, 'informal')), 'a uno informal, de tú');
  ok(!/te escriba|tienes|prefieres/.test(textoDeSeguimiento({}, {}, 'formal')), 'y al formal no se le tutea por descuido');
  ok(/\?/.test(textoDeSeguimiento({}, {}, 'formal')), 'y el mensaje termina en pregunta, como los demás');
}

console.log('\nA quién NO se le escribe');
{
  // Si ya la atiende una persona, un mensaje del agente por encima es peor que
  // el silencio: pisa a quien está respondiendo.
  ok(/status=eq\.bot/.test(src), 'a una conversación que ya atiende una persona, no');
  // Fuera de la ventana de 24h de WhatsApp el mensaje ni siquiera saldría: Meta
  // lo rechaza y quedaría marcado como enviado sin haberlo sido.
  ok(/last_inbound_at=gt\./.test(src), 'ni fuera de la ventana de 24 horas');
  ok(/last_message_at=lt\./.test(src), 'ni antes de que pasen los minutos de silencio');
  ok(/ESPERA_MIN = 10/.test(src), 'que son diez');
  ok(/if \(!ultimos\?\.length \|\| ultimos\[0\]\.role !== 'assistant'\) continue;/.test(src),
     'ni si el último mensaje es de la persona: eso no es silencio suyo, es que no le respondimos');
  ok(/if \(conv\.seguimiento_at && conv\.seguimiento_at >= conv\.last_inbound_at\) continue;/.test(src),
     'ni dos veces seguidas: insistir dos veces es acoso, no seguimiento');
  ok(/if \(!agente\) continue;/.test(src), 'ni en un canal que se atiende a mano');
  ok(/cupo\.agotado\) \{ resumen\.sinCupo\+\+; continue; \}/.test(src),
     'ni si la cuenta agotó su cupo: un seguimiento cuesta como cualquier mensaje');
  // Y no se marca en ese caso, para que salga cuando recupere cupo.
  const iCupo = src.indexOf('resumen.sinCupo++');
  const iMarca = src.indexOf('seguimiento_at: new Date()');
  ok(iCupo < iMarca, 'y al no mandarlo por cupo, tampoco se marca como hecho');
}

console.log('\nNi a deshoras');
{
  ok(enHorario(new Date('2026-09-29T15:00:00Z')) === true, 'a las 10 de la mañana en Colombia, sí');
  ok(enHorario(new Date('2026-09-29T07:00:00Z')) === false, 'a las 2 de la madrugada, no');
  ok(enHorario(new Date('2026-09-30T03:00:00Z')) === false, 'a las 10 de la noche, no');
  ok(enHorario(new Date('2026-09-29T12:30:00Z')) === true, 'a las 7:30 de la mañana, sí');
  ok(/if \(!enHorario\(\)\)/.test(src), 'y el cron lo mira antes de consultar nada');
}

console.log('\nEl envío y su rastro');
{
  ok(/sendMetaMessage/.test(src), 'sale por el único sitio que le habla a un canal');
  ok(!/graph\.facebook\.com/.test(src), 'y no tiene su propia copia de la llamada a Meta');
  ok(/if \(!salio\) continue;/.test(src), 'si no salió, no se guarda como enviado');
  // Se marca AUNQUE falle el envío: reintentar cada diez minutos contra un canal
  // caído acabaría soltando seis mensajes de golpe cuando vuelva.
  ok(src.indexOf('seguimiento_at: new Date()') < src.indexOf('if (!salio) continue;'),
     'pero sí se marca, para no acumular reintentos que salgan todos juntos');
  ok(/sumarUno\(conv\.user_id\)/.test(src), 'y el mensaje cuenta para el cupo, como cualquier otro');
  ok(/role: 'assistant', content: texto/.test(src), 'queda en la conversación');
  ok(/await latir\('cron-seguimiento'/.test(src), 'y el cron deja su latido');
}

console.log('\nDeclarado donde lo busca el vigilante de crons');
{
  const c = (vercel.crons || []).find(x => x.path === '/api/cron-seguimiento');
  ok(!!c, 'está en vercel.json');
  ok(c && c.schedule === '*/10 * * * *', 'cada diez minutos', c && c.schedule);
  ok(/runtime: 'edge'/.test(src), 'y es edge, que es lo que exige importar los api/_*.js');
}

console.log('\nLa columna que lo sostiene existe en la base');
{
  const r = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/chat_conversations?select=seguimiento_at&limit=1`,
    { headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_KEY } }
  );
  ok(r.ok, 'chat_conversations.seguimiento_at se puede consultar', String(r.status));
}

console.log('');
process.exit(mal ? 1 : 0);

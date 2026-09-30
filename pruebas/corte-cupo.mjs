// El corte cuando se agota el cupo: node pruebas/corte-cupo.mjs
//
// Agotar el cupo no puede ser un silencio. El mensaje del cliente se guarda, la
// conversación pasa al equipo y al contacto se le dice que le responde una
// persona. Un cliente que escribe y no recibe nada es un lead perdido, y la
// culpa sería nuestra.
//
// El camino completo se probó ejecutándolo contra el motor real (agente
// contestando, cupo agotándose a mitad de conversación, cliente insistiendo).
// Aquí se fija lo que no puede deshacerse sin que nadie se entere.

import fs from 'fs';
for (const l of fs.readFileSync(process.argv[2] + '/.env', 'utf8').split('\n')) {
  const i = l.indexOf('='); if (i > 0) process.env[l.slice(0, i)] = l.slice(i + 1);
}
// Después del .env: un import estático se evalúa antes y el módulo se quedaría
// sin SUPABASE_URL.
const { consumoCacheado, sumarUno, estadoDeCupo, avisarDelCupo } = await import('../api/_cupo-agente.js');

const motor = fs.readFileSync(new URL('../api/_inbox-engine.js', import.meta.url), 'utf8');
const mod = fs.readFileSync(new URL('../api/_cupo-agente.js', import.meta.url), 'utf8');

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + extra : ''));
  if (!c) mal++;
};

console.log('\nEl corte va antes de gastar el mensaje');
{
  const iCorte = motor.indexOf('const cupo = await estadoDeCupo(connection.user_id');
  const iPrompt = motor.indexOf('const system = partesDelPrompt(', iCorte > 0 ? iCorte : 0);
  const iGuardado = motor.indexOf('const msgRows = await fetch(');
  ok(iCorte > 0, 'el corte existe en processIncoming');
  // Si se comprobara DESPUÉS de llamar al modelo, el mensaje ya estaría
  // gastado y pagado: cortar ahí no ahorra nada.
  ok(iCorte < iPrompt, 'y se comprueba ANTES de armar el prompt y llamar al modelo');
  // Y después de guardar lo que escribió el cliente: cortar antes perdería su
  // mensaje, que es lo único que no se puede recuperar.
  ok(iGuardado > 0 && iGuardado < iCorte, 'y DESPUÉS de guardar el mensaje del cliente');

  const bloque = motor.slice(iCorte, iCorte + 2600);
  ok(/status: 'human'/.test(bloque), 'la conversación pasa a manos del equipo');
  ok(/unread_count: \(conv\.unread_count \|\| 0\) \+ 1/.test(bloque), 'y suma un mensaje sin leer');
  ok(/await send\(connection, contactId, cortes\)/.test(bloque), 'al contacto se le responde algo');
  ok(/role: 'assistant', content: cortes/.test(bloque), 'y ese aviso queda en la conversación');
  ok(/avisarAlResponsable/.test(bloque), 'se avisa al responsable del contacto');
  ok(/avisarDelCupo/.test(bloque), 'y a la cuenta de que se le acabó');
  ok(/return \{ ok: true, cupoAgotado: true/.test(bloque), 'y ahí se para');

  // El aviso de cortesía sale UNA vez porque la conversación queda en 'human':
  // el siguiente mensaje entra por la rama de arriba y no vuelve a pasar aquí.
  const iRamaHuman = motor.indexOf("if (aMano || conv.status === 'human') {");
  ok(iRamaHuman > 0 && iRamaHuman < iCorte,
     'y la rama de «ya está en manos de una persona» va antes, así el aviso no se repite');

  ok(/agent\?\.tone === 'informal'/.test(bloque),
     'el aviso respeta el trato del agente: no se tutea a quien se trata de usted');
}

console.log('\nUn fallo nuestro no deja mudo al agente');
{
  const iCorte = motor.indexOf('const cupo = await estadoDeCupo(connection.user_id');
  const bloque = motor.slice(iCorte, iCorte + 2600);
  // Esto es lo más importante de todo el corte. Si la consulta del cupo falla
  // y eso cortara, una caída nuestra dejaría sin agente a todos los clientes
  // que pagan, y por el camino parecería que se les acabó el cupo.
  ok(/!cupo\.error && cupo\.agotado/.test(bloque),
     'solo se corta si el cupo se pudo consultar Y está agotado');
  ok(/\.catch\(\(\) => \(\{ error: true \}\)\)/.test(bloque),
     'y si la consulta revienta, se trata como «no se pudo», no como agotado');

  const estado = { error: true };
  ok(!(estado && !estado.error && estado.agotado), 'con error, la condición del corte es falsa');
}

console.log('\nEl aviso del 80% no corta');
{
  const iCorte = motor.indexOf('const cupo = await estadoDeCupo(connection.user_id');
  const tras = motor.slice(iCorte, iCorte + 3000);
  const iAviso = tras.indexOf('if (cupo && !cupo.error && cupo.avisar)');
  const iReturn = tras.indexOf('return { ok: true, cupoAgotado: true');
  ok(iAviso > iReturn, 'el aviso del 80% va después del corte, así que solo alcanza a quien NO agotó');
  ok(!/return/.test(tras.slice(iAviso, iAviso + 140)), 'y no para la conversación: el agente sigue contestando');
}

console.log('\nLos avisos a la cuenta salen una vez al mes');
{
  ok(/on_conflict=user_id,agent_key/.test(mod),
     'la marca se guarda con on_conflict, o el segundo guardado daría 409');
  ok(/d\.mes === mesActual\(\) \? d : \{ mes: mesActual\(\) \}/.test(mod),
     'y la marca de otro mes no cuenta: al reiniciarse el contador, se puede volver a avisar');
  ok(/if \(yaAvisado\[cual\]\) return;/.test(mod), 'si ya se avisó, no se repite');
  // El agente pasa por aquí en CADA mensaje entrante. Sin freno serían decenas
  // de correos en una tarde, que es la forma más rápida de enseñarle a un
  // cliente a ignorar nuestros avisos.
  ok(/await marcarAviso\(userId, cual\);/.test(mod), 'y se deja la marca puesta');
  ok(/if \(!email \|\| !process\.env\.RESEND_API_KEY\) \{ await marcarAviso/.test(mod),
     'sin correo del dueño también se marca, para no reintentar en cada mensaje');

  // Con identidad propia: no se escribe en la cuenta de ningún cliente.
  //
  // Y con su fila en `users`: `user_profiles` cuelga de ahí por clave foránea,
  // así que un id inventado a secas da 23503 y la marca no se guarda. Es el
  // mismo tropiezo de la fila espejo que ya costó 500 en el registro.
  const MIO = 'user_prueba_corte_' + Math.random().toString(36).slice(2, 10);
  const h = { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json' };
  const crearEspejo = async (id) => fetch(`${process.env.SUPABASE_URL}/rest/v1/users`, {
    method: 'POST', headers: { ...h, Prefer: 'return=minimal' },
    body: JSON.stringify({ id, email: id + '@prueba.acuarius', name: 'Prueba corte de cupo' }),
  });
  await crearEspejo(MIO);
  const marca = async () => (await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/user_profiles?user_id=eq.${MIO}&agent_key=eq.__cupo_avisos__&select=profile_data`,
    { headers: h }).then(r => r.json()))?.[0]?.profile_data || null;

  await avisarDelCupo(MIO, { cupo: 500, usados: 500, agotado: true, avisar: true });
  const m1 = await marca();
  ok(m1 && m1.agotado === true, 'el aviso de agotado deja su marca', JSON.stringify(m1));

  await avisarDelCupo(MIO, { cupo: 500, usados: 500, agotado: true, avisar: true });
  const m2 = await marca();
  ok(JSON.stringify(m1) === JSON.stringify(m2), 'y el segundo intento no cambia nada');

  // Un estado sin nada que avisar no escribe.
  const OTRO = 'user_prueba_corte_' + Math.random().toString(36).slice(2, 10);
  await crearEspejo(OTRO);
  await avisarDelCupo(OTRO, { cupo: 500, usados: 10, agotado: false, avisar: false });
  const sinNada = (await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/user_profiles?user_id=eq.${OTRO}&agent_key=eq.__cupo_avisos__&select=user_id`,
    { headers: h }).then(r => r.json())) || [];
  ok(sinNada.length === 0, 'y con el cupo a medias no se escribe ni se avisa');

  // Y con el cupo caído tampoco: un error no es un aviso.
  await avisarDelCupo(OTRO, { error: true });
  const trasError = (await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/user_profiles?user_id=eq.${OTRO}&agent_key=eq.__cupo_avisos__&select=user_id`,
    { headers: h }).then(r => r.json())) || [];
  ok(trasError.length === 0, 'ni cuando el cupo no se pudo consultar');

  for (const u of [MIO, OTRO]) {
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/user_profiles?user_id=eq.${u}`, { method: 'DELETE', headers: h });
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/users?id=eq.${u}`, { method: 'DELETE', headers: h });
  }
  const quedan = (await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/user_profiles?user_id=like.user_prueba_corte_*&select=user_id`,
    { headers: h }).then(r => r.json())) || [];
  ok(quedan.length === 0, 'y la prueba se limpia lo suyo', String(quedan.length));
}

console.log('\nEl conteo cacheado no hace llegar tarde el corte');
{
  const CERTAIN = 'user_3HYi3uHYQyth190Tr2HXZKmHbTk';
  const base = await consumoCacheado(CERTAIN);
  ok(typeof base === 'number', 'el conteo cacheado devuelve un número', String(base));

  // Con la caché de un minuto, una ráfaga de mensajes seguiría viendo el número
  // de hace un rato: el agente respondería de más y el corte llegaría tarde.
  sumarUno(CERTAIN); sumarUno(CERTAIN);
  const despues = await consumoCacheado(CERTAIN);
  ok(despues === base + 2, 'y cada mensaje gastado se suma al vuelo', `${base} → ${despues}`);

  ok(/sumarUno\(connection\.user_id\);/.test(motor), 'el motor lo suma cuando el agente responde');
  const iEnvio = motor.indexOf('await send(connection, contactId, visible)');
  const iSuma = motor.indexOf('sumarUno(connection.user_id)');
  ok(iSuma > iEnvio, 'y lo suma después de enviar, no antes de saber si salió');

  // Un fallo no se cachea: si se guardara, el error duraría un minuto entero.
  ok(/if \(n !== null\) _conteoCache\.set/.test(mod), 'un conteo fallido no se cachea');
  ok(/_conteoCache = new Map\(\)/.test(mod), 'y la caché va por cuenta, no en una variable suelta');
}

console.log('');
process.exit(mal ? 1 : 0);

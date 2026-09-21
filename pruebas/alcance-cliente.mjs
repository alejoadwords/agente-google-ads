// Alcance por cliente: node pruebas/alcance-cliente.mjs
//
// Esto es una frontera: si falla, alguien ve los datos de un cliente que no es
// el suyo. Y la trampa es que un solo endpoint sin acotar basta — hay 19 sitios
// que leen el cliente de la peticion, y da igual que 18 esten bien.
//
// La defensa vive en el SERVIDOR a proposito. Esconderlo en la pantalla no es
// un permiso: basta cambiar un parametro en la barra de direcciones.

import { readFileSync, readdirSync } from 'node:fs';
import { alcanceDeCliente, clienteAjeno } from '../api/_perfiles.js';

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};
const lee = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

console.log('\nLa regla\n');
{
  const acotado = { cliente: 'cli_acuarius' };
  const libre = { cliente: null };
  chk('un miembro acotado trabaja siempre en SU cliente',
      alcanceDeCliente(acotado, null) === 'cli_acuarius');
  chk('y no se sale aunque el navegador pida otro',
      alcanceDeCliente(acotado, 'cli_certain') === 'cli_acuarius');
  chk('el dueño trabaja con el que pidio', alcanceDeCliente(libre, 'cli_certain') === 'cli_certain');
  chk('y sin pedir nada, con ninguno', alcanceDeCliente(libre, null) === null);
  chk('se puede detectar el intento', clienteAjeno(acotado, 'cli_certain') === true);
  chk('pedir el suyo no es un intento', clienteAjeno(acotado, 'cli_acuarius') === false);
  chk('y quien no esta acotado nunca lo es', clienteAjeno(libre, 'cli_certain') === false);
}

console.log('\nquienPregunta trae el alcance\n');
{
  const perf = lee('api/_perfiles.js');
  chk('lo pide en la consulta', /select=owner_user_id,member_name,member_email,role,client_id/.test(perf));
  chk('lo devuelve', /cliente: fila\.client_id \|\| null/.test(perf));
  chk('el dueño lo trae vacio', /esDueno: true, nombre: null, cliente: null/.test(perf));
  chk('y la pantalla lo recibe para acotar el selector', /cliente: quien\.cliente \|\| null/.test(perf));
}

console.log('\nNINGUN endpoint lee el cliente sin acotarlo\n');
{
  // La comprobacion que de verdad importa. Recorre api/ entera y falla si
  // encuentra una lectura de client_id que no pase por el alcance.
  const sueltos = [];
  for (const f of readdirSync(new URL('../api', import.meta.url))) {
    if (!f.endsWith('.js')) continue;
    lee('api/' + f).split('\n').forEach((l, i) => {
      if (!/searchParams\.get\('client_id'\)/.test(l)) return;
      const acotada = /alcanceDeCliente\(|clienteDelMiembro \|\||clienteDe\(userId\)\) \|\|/.test(l);
      if (!acotada) sueltos.push(`${f}:${i + 1}`);
    });
  }
  chk('ni una lectura suelta', sueltos.length === 0, sueltos.join(', '));
}

console.log('\nLos que resuelven el miembro por su cuenta\n');
{
  // Once endpoints tienen su propia copia de "resuelve el dueño". Cada uno tiene
  // que pedir tambien el cliente, capturarlo y forzarlo.
  const files = ['agenda','chat-agents','email-templates','leads','knowledge-sync','lead-tags',
                 'nps','lead-sources','quick-replies','pipelines','proposals'];
  const mal = [];
  for (const f of files) {
    const s = lee(`api/${f}.js`);
    const pide = /select=owner_user_id[a-z_,]*client_id/.test(s);
    const captura = /clienteDelMiembro = /.test(s);
    const declara = /let clienteDelMiembro = null/.test(s);
    const fuerza = /clienteDelMiembro \|\|/.test(s);
    if (!(pide && captura && declara && fuerza)) mal.push(f);
  }
  chk('los once lo piden, lo capturan y lo fuerzan', mal.length === 0, mal.join(', '));
}

console.log('\nEl inbox, que no filtraba nada\n');
{
  const cc = lee('api/chat-conversations.js');
  chk('resuelve el alcance del miembro', /clienteDelMiembro = _tw\.client_id/.test(cc));
  chk('lo traduce a canales, porque la conversacion no guarda el cliente',
      /channel_connections[\s\S]{0,200}?client_id=eq\.\$\{encodeURIComponent\(clienteDelMiembro\)\}/.test(cc));
  chk('sin canales para ese cliente, bandeja vacia — no la de otro',
      /connection_id=is\.null&id=eq\.00000000/.test(cc));
  const cuantas = (cc.match(/\$\{filtroCanales\}/g) || []).length;
  chk('las cuatro consultas de conversaciones lo llevan', cuantas === 4, cuantas + ' consultas');
  chk('incluida la de abrir una conversacion por id',
      /chat_conversations\?id=eq\.\$\{convId\}&user_id=eq\.\$\{userId\}\$\{filtroCanales\}/.test(cc));
}

console.log('\nAlta y cambio del alcance\n');
{
  const t = lee('api/team.js');
  chk('la invitacion acepta el cliente', /client_id: alcanceQuePuedeDar\(quien, body\.client_id\)/.test(t));
  chk('vacio = toda la cuenta, como siempre', /status: 'invited', invite_token: token/.test(t));
  chk('el listado del equipo lo devuelve', /role,status,client_id,created_at,joined_at/.test(t));
  chk('y se puede quitar despues, no solo poner',
      /'client_id' in \(body \|\| \{\}\)/.test(t));
}

console.log('\nNadie da mas acceso del que tiene\n');
{
  const t = lee('api/team.js');
  // Un administrador ACOTADO puede gestionar el equipo de su cliente. Si ademas
  // pudiera invitar a alguien SIN acotar, la frontera entera seria decorativa:
  // bastaria crear un comodin y entrar con el.
  chk('existe el limite de lo que se puede conceder',
      /function alcanceQuePuedeDar\(quien, pedido\)/.test(t));
  chk('quien esta acotado solo puede dar SU cliente',
      /if \(quien && quien\.cliente\) return quien\.cliente;/.test(t));
  chk('se aplica al invitar', /client_id: alcanceQuePuedeDar\(quien, body\.client_id\)/.test(t));
  chk('y al cambiarle el alcance a otro',
      /'client_id' in \(body \|\| \{\}\) \? \{ client_id: alcanceQuePuedeDar\(quien, body\.client_id\) \}/.test(t));

  chk('y solo puede tocar a los de su propio cliente',
      /function esDeMiCliente\(quien, fila\)/.test(t));
  chk('el guarda esta en los dos sitios que ya comprobaban permisos',
      (t.match(/if \(!esDeMiCliente\(quien, fila\)\)/g) || []).length === 2);
  chk('y la fila trae el cliente para poder compararlo',
      /select=id,member_user_id,member_email,role,status,client_id/.test(t));
  chk('sigue impedido cambiarse el perfil a uno mismo',
      /filaObjetivo\.member_user_id === quien\.actorId\) return false/.test(lee('api/_perfiles.js')));
}

console.log('\nLa pauta no se cuela por la puerta de atras\n');
{
  const pa = lee('api/pauta.js');
  // Una conexion de pauta SIN cliente asignado se enseña dentro de cualquier
  // cliente a proposito —para poder asignarla desde ahi—. Para el dueño esta
  // bien; para un miembro acotado es la inversion y las campañas de otro.
  chk('el ayudante sabe si debe incluir las sueltas',
      /async function conexionesDe\(userId, clientId, sueltasTambien = true\)/.test(pa));
  chk('a un acotado NO se le incluyen',
      /\} else if \(clientId\) \{\s*\n\s*ruta \+= `&client_id=eq\./.test(pa));
  chk('las dos vistas de campaña lo pasan',
      (pa.match(/conexionesDe\(quien\.userId, clientId, !quien\.cliente\)/g) || []).length === 2);
  chk('y la vista de cartera se encoge a lo suyo',
      /const soloMio = quien\.cliente \|\| null;/.test(pa) &&
      /conexionesDe\(quien\.userId, soloMio, !soloMio\)/.test(pa));
  chk('incluidos sus leads y su lista de clientes',
      /leadsDelPeriodo\(quien\.userId, soloMio, desde, hasta, null\)/.test(pa) &&
      /soloMio \? `&id=eq\.\$\{encodeURIComponent\(soloMio\)\}` : ''/.test(pa));
}

console.log('\nLa pantalla\n');
{
  const app = lee('public/app.js');
  const idx = lee('public/index.html');
  chk('la cartera se acota al cliente del miembro', /function agencySoloElMio\(\)/.test(app));
  chk('en las dos vias de carga', (app.match(/agencySoloElMio\(\);/g) || []).length === 2);
  chk('el formulario deja elegir el cliente', /id="cfg-team-cliente"/.test(idx));
  chk('y se manda al invitar', /client_id: \(document\.getElementById\('cfg-team-cliente'\)/.test(app));
  chk('el selector se pinta al abrir Equipo', /teamRenderSettings\(\) \{\n  teamPintarClientes\(\);/.test(app));
  chk('sin cartera, el campo ni aparece', /if \(!lista\.length\) \{ wrap\.hidden = true; return; \}/.test(app));
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);

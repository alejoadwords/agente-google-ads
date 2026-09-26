// El Pulso del móvil dice lo mismo que el de la web: node pruebas/pulso-coincide.mjs
//
// Un cliente abrió la cuenta en el computador y en el teléfono a la vez y los
// dos Pulsos daban números distintos: 10 tareas vencidas contra 5, 8 leads sin
// actividad contra 13, 24 nuevos contra 18. Sobre la MISMA cuenta y el mismo
// cliente.
//
// Tres causas, y ninguna era la regla: era de dónde salían los datos.
//   1. El móvil pedía `/api/leads?limit=200` y la cuenta tiene 377.
//   2. Pedía `/api/agenda?proximos=1`, un parámetro que no existe, así que
//      caía en la rama del calendario — otra lista, otro alcance.
//   3. Y reclasificaba las tareas por su cuenta en vez de usar las cestas que
//      ya manda el servidor.
//
// Esta prueba vigila el ORIGEN, no el resultado: dos pantallas que leen lo
// mismo no pueden decir cosas distintas.

import { readFileSync } from 'node:fs';
import { cargarTodo } from '../public/movil-datos.js';

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};
const leer = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
// Sin quitar los comentarios, estas aserciones chocan con el comentario que
// explica el fallo: el texto «?proximos=1» está ahí a propósito, para que nadie
// lo reintroduzca sin saber qué pasó. Lo que importa es que no esté en el
// CÓDIGO. Ya me pasó cuatro veces; por eso esto va arriba del todo.
const soloCodigo = (t) => t.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const app = soloCodigo(leer('public/app.js'));
const datos = soloCodigo(leer('public/movil-datos.js'));

console.log('\nLos dos leen las mismas puertas\n');
{
  // La web pide `/api/leads` sin recortar. Un límite en el móvil hace que vea
  // otro conjunto, y entonces cualquier cuenta que lo pase da dos verdades.
  chk('el móvil no recorta los contactos', !/api\/leads\?limit=/.test(datos),
      (datos.match(/api\/leads\?limit=\d+/) || [''])[0]);
  // `?tareas=1` es la puerta de la lista de trabajo. Es la que excluye las
  // tareas de leads cerrados o borrados y la que incluye las que no cuelgan de
  // ningún cliente. La del calendario no hace ni lo uno ni lo otro.
  chk('las tareas salen de ?tareas=1, como en la web', /api\/agenda\?tareas=1/.test(datos));
  chk('y la web usa esa misma puerta', /api\/agenda\?tareas=/.test(app));
  // El parámetro que no existía. Si vuelve, la petición cae otra vez en el
  // calendario sin que nadie lo note: devuelve 200 y una lista con datos.
  chk('ya no se inventa un parámetro que el servidor no lee',
      !/proximos=1/.test(datos), 'sigue pidiendo ?proximos=1');
}

console.log('\nLa clasificación la hace el servidor, no cada pantalla\n');
{
  // El servidor corta por DÍA y deja fuera lo de leads cerrados. Recalcularlo
  // en el cliente era garantizar que los dos números se separaran al primer
  // cambio de criterio — y se separaron.
  chk('se usan las cestas tal cual vienen', /deCesta\(tareas\.vencidas, 'vencida'\)/.test(datos));
  // Lo que importa: que `tareas:` salga de las cestas y NO de una lista que el
  // cliente reclasifique. Se mira el trozo del `return`, no el fichero entero:
  // `aTarea` se sigue usando —da el texto y la hora—, y prohibirla a secas
  // señalaría un uso legítimo.
  // El cierre se busca DESPUÉS del inicio: `citas:` aparece antes, en
  // `cargarFicha`, y buscándolo desde el principio el trozo salía vacío —y un
  // trozo vacío hace pasar cualquier aserción que solo mire lo que NO está.
  const desde = datos.indexOf('    tareas: tareas');
  if (desde < 0) throw new Error('no encontré el return de cargarTodo: revisa esta prueba');
  const ret = datos.slice(desde, datos.indexOf('    citas:', desde));
  if (!ret.trim()) throw new Error('el trozo del return salió vacío');
  chk('y no se recalcula el «cuándo»',
      /deCesta\(/.test(ret) && !/\.map\(\(a\) => aTarea\(a\)\)/.test(ret), ret.trim().slice(0, 120));

  const ok = (o) => ({ ok: true, json: async () => o });
  const por = (mapa) => async (ruta) => {
    for (const [k, v] of Object.entries(mapa)) if (ruta.startsWith(k)) return v;
    return { ok: false, json: async () => ({}) };
  };
  // Una tarea SIN fecha que el servidor mete en «hoy» tiene que quedarse en
  // «hoy». La regla del cliente la mandaría a «próxima» y el contador del
  // Pulso bajaría sin motivo.
  const d = await cargarTodo(por({
    '/api/leads': ok({ leads: [] }),
    '/api/agenda?tareas=1': ok({ vencidas: [{ id: 'a', title: 'Vieja' }], hoy: [{ id: 'b', title: 'Sin fecha' }], proximas: [] }),
    '/api/agenda': ok({ activities: [] }),
    '/api/chat-conversations': ok({ conversations: [] }),
    '/api/pipelines': ok({ pipelines: [] }),
  }), { clientId: 'pro_main' });
  chk('manda la cesta del servidor, no la regla del cliente',
      d.tareas.map((t) => t.cuando).join(',') === 'vencida,hoy', d.tareas.map((t) => t.cuando).join(','));

  // Y si esa consulta falla, null: decir «nada pendiente» sería afirmar que el
  // asesor está al día sin haberlo mirado.
  const roto = await cargarTodo(por({
    '/api/leads': ok({ leads: [] }),
    '/api/agenda': ok({ activities: [] }),
    '/api/chat-conversations': ok({ conversations: [] }),
    '/api/pipelines': ok({ pipelines: [] }),
  }), {});
  chk('si las tareas no llegan, viene null y no una lista vacía',
      roto.tareas === null, JSON.stringify(roto.tareas));
  // Una respuesta 200 con otra forma —el catch-all devuelve el shell— tampoco
  // puede leerse como «no hay tareas».
  const raro = await cargarTodo(por({
    '/api/leads': ok({ leads: [] }),
    '/api/agenda?tareas=1': ok({ activities: [] }),
    '/api/agenda': ok({ activities: [] }),
    '/api/chat-conversations': ok({ conversations: [] }),
    '/api/pipelines': ok({ pipelines: [] }),
  }), {});
  chk('y una respuesta con otra forma también es null', raro.tareas === null, JSON.stringify(raro.tareas));
}

console.log('\nEl Pulso cuenta el mismo conjunto que la web\n');
{
  const mov = soloCodigo(leer('public/movil-app.js'));
  const i = mov.indexOf('function pulsoDeDatos');
  const fn = mov.slice(i, mov.indexOf('\n  return cards;', i));

  // La web filtra por CLIENTE y nada más. El móvil filtraba además por el
  // tablero elegido, así que decía 6 donde el computador decía 9 sobre la
  // misma cuenta — y el usuario no tenía forma de saber cuál creer.
  chk('el Pulso NO filtra por tablero',
      !/pipelineActual\)\s*leads = leads\.filter/.test(fn),
      (fn.match(/pipelineActual[^\n]{0,70}/) || [''])[0]);
  // Y como cuenta todos, al ir a la lista se quita el filtro: una tarjeta que
  // dice 9 y una lista que enseña 6 convierte el número en ruido.
  // Los DOS botones que llevan a la lista de contactos, no uno: contar que
  // aparezca una vez deja pasar que al otro se le olvide.
  const aLaLista = (fn.match(/ir:function\(\)\{ [^}]*verSub\('crm','leads'\)/g) || []);
  chk('los dos botones llevan a la lista', aLaLista.length === 2, String(aLaLista.length));
  chk('y los dos quitan el filtro de tablero',
      aLaLista.every((x) => /verTodosLosTableros\(\)/.test(x)),
      aLaLista.filter((x) => !/verTodosLosTableros/.test(x)).join(' | '));

  // Solo una tarea para HOY o más adelante salva a un lead. Una vencida es
  // justo la señal de que lleva tiempo parado: contarla escondía abandonados.
  chk('solo una tarea futura evita el «sin actividad»',
      /t\.cuando === 'hoy' \|\| t\.cuando === 'proxima'/.test(fn), 'cuenta también las vencidas');
  chk('y la web hace lo mismo', /f >= crmFechaLocal\(new Date\(\)\)/.test(app));

  // Las dos ventanas, iguales.
  chk('«nuevo hoy» son las últimas 24 h en los dos',
      /ahora - \(l\.creado \|\| 0\)\) < DIA/.test(fn)
      && /now - new Date\(l\.created_at\)\.getTime\(\)\) < DAY/.test(app));
}

console.log('\nLas reglas del Pulso siguen siendo las mismas\n');
{
  const mov = leer('public/movil-app.js');
  // Tres días para «sin actividad», en los dos.
  chk('«sin actividad» son más de 3 días en la web', /3 \* DAY/.test(app));
  chk('y en el móvil', /3 \* 864e5|3 \* DIA|> 3 \* 86400000/.test(mov),
      (mov.match(/sin actividad[\s\S]{0,300}?(\d+ \* [0-9e]+)/) || [, '?'])[1]);
  // Y ninguno cuenta como abandonado a quien ya tiene su llamada agendada.
  chk('ninguno acusa a quien tiene tarea pendiente',
      /tieneSeguimientoProgramado/.test(app) && /conTarea|tienePendiente/.test(mov));
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);

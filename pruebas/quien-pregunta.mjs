// quienPregunta y su reintento: node pruebas/quien-pregunta.mjs
//
// Esta consulta la hace CADA endpoint en CADA petición: al abrir una pantalla
// salen diez a la vez. Un tropiezo de un segundo en Supabase dejaba media
// pantalla en blanco con un 503 y un mensaje que no decía nada — 20 veces en
// tres horas el 21-09-2026, en tres cuentas distintas.
//
// No toca la base: se sustituye `fetch` para provocar el fallo a voluntad, que
// es la única forma de probar un tropiezo de red.

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

process.env.SUPABASE_URL = 'https://ejemplo-de-prueba.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'clave-de-prueba';

const { quienPregunta } = await import('../api/_perfiles.js');

// `guion` dice qué contesta cada intento a team_members. Lo que vaya al RPC de
// errores se apunta aparte.
let guion = [];
let intentos = 0;
const anotados = [];
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('rpc/registrar_error')) {
    anotados.push(JSON.parse(opts.body));
    // 200 y no 204: Node no deja construir un 204 con cuerpo, y el ruido en la
    // salida parecería un fallo de verdad.
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (u.includes('team_members')) {
    const paso = guion[intentos++] ?? { tipo: 'ok', filas: [] };
    if (paso.tipo === 'lanza') throw new Error(paso.mensaje || 'socket colgado');
    if (paso.tipo === 'error') {
      return new Response(paso.cuerpo || 'boom', { status: paso.status || 500 });
    }
    return new Response(JSON.stringify(paso.filas || []), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }
  throw new Error('petición no contemplada: ' + u);
};
const arrancar = (g) => { guion = g; intentos = 0; anotados.length = 0; };

console.log('\nEl camino normal no cambia\n');
{
  arrancar([{ tipo: 'ok', filas: [] }]);
  const q = await quienPregunta('user_x');
  chk('el dueño sale como dueño y admin', q.esDueno === true && q.perfil === 'admin' && q.esMiembro === false);
  chk('con una sola petición', intentos === 1, String(intentos));

  arrancar([{ tipo: 'ok', filas: [{ owner_user_id: 'user_dueno', role: 'ventas', member_name: 'Ana', client_id: 'cli_1' }] }]);
  const m = await quienPregunta('user_y');
  chk('un miembro opera sobre la cuenta del dueño', m.userId === 'user_dueno' && m.actorId === 'user_y');
  chk('y trae su perfil y su cliente', m.perfil === 'ventas' && m.cliente === 'cli_1');
}

console.log('\nUn tropiezo ya no se le nota al usuario\n');
{
  // Esto es lo que pasaba 20 veces: el primer intento falla. Antes, 503.
  arrancar([{ tipo: 'error', status: 500 }, { tipo: 'ok', filas: [] }]);
  const q = await quienPregunta('user_z');
  chk('el segundo intento lo salva', q.esDueno === true);
  chk('hubo exactamente dos intentos', intentos === 2, String(intentos));
  chk('y no se anota ningún error: no llegó a fallar', anotados.length === 0, JSON.stringify(anotados));

  // Y también si lo que falla es la red, no el servidor.
  arrancar([{ tipo: 'lanza', mensaje: 'fetch failed' }, { tipo: 'ok', filas: [] }]);
  await quienPregunta('user_z2');
  chk('un corte de red también se reintenta', intentos === 2, String(intentos));
}

console.log('\nCuando falla de verdad, se sabe POR QUÉ\n');
{
  arrancar([
    { tipo: 'error', status: 503, cuerpo: '{"message":"upstream connect error"}' },
    { tipo: 'error', status: 503, cuerpo: '{"message":"upstream connect error"}' },
  ]);
  let error = null;
  try { await quienPregunta('user_w'); } catch (e) { error = e; }
  chk('lanza, no devuelve una cuenta inventada', !!error);
  chk('el mensaje lleva el estado', /503/.test(error.message), error && error.message);
  chk('y lo que dijo el servidor', /upstream connect error/.test(error.message), error && error.message);
  chk('se reintentó antes de rendirse', intentos === 2, String(intentos));

  chk('queda anotado en el registro de errores', anotados.length === 1, String(anotados.length));
  const a = anotados[0] || {};
  chk('con origen api', a.p_origen === 'api', a.p_origen);
  chk('y diciendo dónde', a.p_donde === 'quienPregunta', a.p_donde);
  chk('con la cuenta afectada', a.p_usuario === 'user_w', a.p_usuario);
  chk('y el motivo real en el detalle', /503[\s\S]*upstream connect error/.test(a.p_detalle || ''), a.p_detalle);
}

console.log('\nLo que ve el usuario sigue siendo amable\n');
{
  // El endpoint traduce cualquier fallo a esto. Que el motivo técnico viaje en
  // el Error es para el registro, no para la pantalla.
  const { readFileSync } = await import('node:fs');
  const pipelines = readFileSync(new URL('../api/pipelines.js', import.meta.url), 'utf8');
  chk('/api/pipelines contesta 503 con un mensaje entendible',
      /No se pudo verificar tu cuenta\. Reintenta en unos segundos\./.test(pipelines));
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);

// pruebas/prueba-no-caduca-a-un-asesor.mjs
//
// Un asesor invitado a una cuenta que paga se registra como cualquiera y se
// lleva su prueba de 14 días. Sin este corte, `cron-trials` le escribe «tu
// prueba terminó, paga $39» y le deja el plan en 'free' en Clerk —a los seis
// asesores de Certain les tocaba el 28-09-2026—.
//
// Se ejecuta el cron de verdad con el mundo de fuera simulado: Clerk devuelve
// dos usuarios con la prueba ya vencida, uno es asesor y el otro no. Se mira
// a quién se le toca el plan y a quién se le escribe.

process.env.CRON_SECRET = 'secreto-de-prueba';
process.env.CLERK_SECRET_KEY = 'ck_prueba';
process.env.SUPABASE_URL = 'https://ejemplo.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'llave';
process.env.RESEND_API_KEY = 're_prueba';

const ASESOR = 'user_asesor', SUELTO = 'user_suelto';
const vencida = new Date(Date.now() - 86400000).toISOString();
const usuario = (id) => ({
  id,
  public_metadata: { plan: 'trial', trial_until: vencida },
  email_addresses: [{ email_address: id + '@ejemplo.com' }],
});

const tocados = [], correos = [];
let paginas = 0;

globalThis.fetch = async (url, opt = {}) => {
  const u = String(url);
  if (u.includes('team_members')) {
    return new Response(JSON.stringify([{ member_user_id: ASESOR }]), { status: 200 });
  }
  if (u.includes('api.clerk.com/v1/users?')) {
    // Una sola página; la segunda vuelve vacía para que el bucle pare.
    return new Response(JSON.stringify(paginas++ ? [] : [usuario(ASESOR), usuario(SUELTO)]), { status: 200 });
  }
  if (u.includes('/metadata')) { tocados.push(u.split('/users/')[1].split('/')[0]); return new Response('{}', { status: 200 }); }
  if (u.includes('resend.com')) { correos.push(JSON.parse(opt.body).to?.[0]); return new Response('{}', { status: 200 }); }
  return new Response('[]', { status: 200 });
};

const { default: handler } = await import('../api/cron-trials.js');

let cuerpo = null;
const res = { status: () => res, json: (x) => { cuerpo = x; return res; } };
await handler({ headers: { authorization: 'Bearer secreto-de-prueba' } }, res);

let mal = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) mal++; };

ok(!tocados.includes(ASESOR), 'al asesor no se le toca el plan');
ok(tocados.includes(SUELTO), 'al que sí tiene cuenta propia se le caduca');
ok(!correos.some(c => String(c).startsWith(ASESOR)), 'al asesor no se le escribe');
ok(correos.some(c => String(c).startsWith(SUELTO)), 'al otro sí se le avisa');
ok(cuerpo?.de_equipo === 1, 'el cron reporta a cuántos se saltó: ' + cuerpo?.de_equipo);
ok(cuerpo?.expired === 1, 'y cuántos caducaron de verdad: ' + cuerpo?.expired);

process.exit(mal ? 1 : 0);

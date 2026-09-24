// pruebas/cron-notas-sin-leer.mjs
//
// A las 24 horas se recuerda UNA vez una nota que nadie abrió. Lo que hay que
// proteger no es que el correo salga —eso es fácil— sino que no se convierta
// en ruido: un recordatorio que se repite solo enseña a filtrarlo, y entonces
// no sirve el día que importa.
//
// Se ejecuta el cron de verdad con Supabase, Resend y Clerk simulados.

process.env.CRON_SECRET = 'secreto';
process.env.SUPABASE_URL = 'https://ejemplo.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'llave';
process.env.RESEND_API_KEY = 're_prueba';
process.env.CLERK_SECRET_KEY = 'ck';

const hace = (h) => new Date(Date.now() - h * 3600000).toISOString();

let estado = {};
const reiniciar = () => {
  estado = { correos: [], marcadas: [], push: [], candados: new Set(), consulta: '' };
};

globalThis.fetch = async (url, opt = {}) => {
  const u = String(url);
  const ok = (b) => new Response(JSON.stringify(b), { status: 200 });

  if (u.includes('/lead_activities?type=eq.nota')) { estado.consulta = u; return ok(estado.notas); }
  if (u.includes('/lead_activities?id=eq.')) {
    estado.marcadas.push({ id: u.split('id=eq.')[1], metadata: JSON.parse(opt.body).metadata });
    return ok({});
  }
  if (u.includes('/cron_envios')) {
    const clave = JSON.parse(opt.body).clave;
    if (estado.candados.has(clave)) return new Response('', { status: 409 });
    estado.candados.add(clave);
    return new Response('', { status: 201 });
  }
  if (u.includes('/team_members')) return ok([{ member_email: 'asesor@certainpezzano.com', member_name: 'Deysy' }]);
  if (u.includes('/leads?id=in.')) return ok([{ id: 'l1', name: 'DORIS BLANCO', company: null }, { id: 'l2', name: 'KEVIN RUEDA' }]);
  if (u.includes('api.clerk.com')) return ok({ email_addresses: [{ email_address: 'dueno@ejemplo.com' }] });
  if (u.includes('resend.com')) { estado.correos.push(JSON.parse(opt.body)); return ok({ id: '1' }); }
  if (u.includes('/cron_latidos')) return ok({});
  if (u.includes('/push_subs')) return ok([]);
  return ok([]);
};

const { default: handler } = await import('../api/cron-notas.js');
const correr = async (notas) => {
  reiniciar(); estado.notas = notas;
  const r = await handler(new Request('https://x/api/cron-notas', {
    headers: { authorization: 'Bearer secreto' },
  }));
  return { cuerpo: await r.json(), estado, status: r.status };
};

let mal = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) mal++; };

const nota = (id, para, lead, horas) => ({
  id, user_id: 'dueno', lead_id: lead, content: 'Confirma la visita del jueves',
  created_at: hace(horas), metadata: { para },
});

// ── Un correo por persona, no uno por nota ─────────────────────────────
let r = await correr([nota('n1', 'u1', 'l1', 30), nota('n2', 'u1', 'l2', 26)]);
ok(r.estado.correos.length === 1, 'dos notas de la misma persona = UN correo, no dos');
ok(/2 notas sin abrir/.test(r.estado.correos[0].subject), 'y el asunto dice cuántas: ' + r.estado.correos[0].subject);
ok(r.cuerpo.recordadas === 2 && r.cuerpo.personas === 1, 'el resumen cuadra');
ok(r.estado.marcadas.length === 2, 'las dos quedan marcadas');
ok(r.estado.marcadas.every(m => m.metadata.recordada_at), 'con la marca de recordada');
ok(r.estado.marcadas.every(m => m.metadata.para === 'u1'),
   'sin perder a quién iban: se conserva el resto del metadata');

// ── Dos personas, dos correos ──────────────────────────────────────────
r = await correr([nota('n1', 'u1', 'l1', 30), nota('n2', 'u2', 'l2', 30)]);
ok(r.estado.correos.length === 2, 'dos personas distintas sí reciben uno cada una');

// ── No se insiste ──────────────────────────────────────────────────────
ok(/recordada_at=is\.null/.test(r.estado.consulta),
   'la consulta excluye las ya recordadas: se avisa UNA vez por nota');
ok(/leida_at=is\.null/.test(r.estado.consulta), 'y las que ya se abrieron no entran');

// ── Solo las que llevan más de un día, y no las antiguas ───────────────
ok(/created_at=lt\./.test(r.estado.consulta) && /created_at=gt\./.test(r.estado.consulta),
   'se pide una ventana: más de 24 h, menos de 7 días');
const corte = decodeURIComponent((r.estado.consulta.match(/created_at=lt\.([^&]+)/) || [])[1] || '');
const horasCorte = (Date.now() - new Date(corte).getTime()) / 3600000;
ok(Math.abs(horasCorte - 24) < 0.1, 'el corte son 24 horas exactas (' + horasCorte.toFixed(1) + ')');

// ── Una persona, un recordatorio al día ────────────────────────────────
reiniciar(); estado.notas = [nota('n1', 'u1', 'l1', 30)];
await handler(new Request('https://x', { headers: { authorization: 'Bearer secreto' } }));
const primeros = estado.correos.length;
estado.notas = [nota('n9', 'u1', 'l2', 30)];          // le llega otra nota vieja el mismo día
await handler(new Request('https://x', { headers: { authorization: 'Bearer secreto' } }));
ok(primeros === 1 && estado.correos.length === 1,
   'aunque le lleguen más notas el mismo día, no se le escribe dos veces');

// ── Sin nada pendiente, no se hace ruido ───────────────────────────────
r = await correr([]);
ok(r.estado.correos.length === 0 && r.cuerpo.recordadas === 0, 'sin notas pendientes no manda nada');

// ── Y sin el secreto, nada ─────────────────────────────────────────────
reiniciar(); estado.notas = [nota('n1', 'u1', 'l1', 30)];
const sin = await handler(new Request('https://x', { headers: {} }));
ok(sin.status === 401 && estado.correos.length === 0, 'sin el secreto del cron no manda nada');

process.exit(mal ? 1 : 0);

#!/usr/bin/env node
// tools/soporte.mjs — radiografía de una cuenta desde la terminal.
//
//   node tools/soporte.mjs                    → lista las cuentas
//   node tools/soporte.mjs certainpezzano     → busca por correo o nombre
//   node tools/soporte.mjs user_3HYi3u…       → por identificador
//
// Es el primer paso de cualquier soporte: antes de teorizar sobre por qué al
// cliente "no le llegan los leads", se mira su cuenta.
//
// TRES REGLAS QUE NO SE TOCAN
//
//   1. SOLO LEE. Ni un UPDATE, ni un INSERT, ni un DELETE. Si hay que cambiar
//      algo en la cuenta de un cliente, se decide con Alejandro y se hace a la
//      vista, no desde una herramienta de diagnóstico.
//   2. NO SACA DATOS PERSONALES DE LOS LEADS ni el contenido de los mensajes.
//      Para diagnosticar hace falta saber que las cosas existen y cómo están
//      configuradas, no leer las conversaciones de terceros. Mismo criterio que
//      api/diagnostico.js.
//   3. La credencial sale del llavero (la sesión del CLI de Supabase). No se
//      escribe en ningún fichero ni se pasa por argumento.
//
// Los avisos son la parte que ahorra tiempo: repiten los desajustes que de
// verdad han generado tickets, no una lista teórica.

import { execSync } from 'node:child_process';

const PROYECTO = 'qgznzzhkuwxcknmcnrzn';
const LIMITES_PLAN = { free: 10, trial: 2000, pro: 2000, agency: 10000 };

function token() {
  try {
    const cru = execSync('security find-generic-password -s "Supabase CLI" -w', { encoding: 'utf8' }).trim();
    return Buffer.from(cru.replace(/^go-keyring-base64:/, ''), 'base64').toString('utf8').trim();
  } catch {
    console.error('No se pudo leer el token del llavero. ¿Tiene sesión el CLI de Supabase? (supabase login)');
    process.exit(1);
  }
}

const TOK = token();
async function sql(consulta) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOK}`,
      'Content-Type': 'application/json',
      // Obligatorio: sin User-Agent normal, Cloudflare corta con 403 y el
      // error no tiene nada que ver con el token.
      'User-Agent': 'SupabaseCLI/2.72.7',
    },
    body: JSON.stringify({ query: consulta }),
  });
  const txt = await r.text();
  if (!r.ok) { console.error('Error consultando Supabase:', txt.slice(0, 300)); process.exit(1); }
  try { return JSON.parse(txt); } catch { return []; }
}

const esc = (s) => String(s).replace(/'/g, "''");
const dia = (d) => (d ? String(d).slice(0, 10) : '—');
const dias = (d) => (d ? Math.floor((Date.now() - new Date(d)) / 86400000) : null);

// ── Listado ──────────────────────────────────────────────────────────────────
async function listar() {
  const filas = await sql(`select u.id, u.email, u.name, u.plan, u.created_at,
      (select count(*) from public.leads l where l.user_id = u.id and l.deleted_at is null) as leads
    from public.users u order by u.created_at desc limit 40;`);
  console.log('\n  CUENTAS\n');
  for (const u of filas) {
    console.log(`  ${(u.email || '(sin correo)').padEnd(38)} ${String(u.plan || '').padEnd(8)} ${String(u.leads).padStart(5)} leads   ${dia(u.created_at)}`);
  }
  console.log(`\n  Radiografía de una:  node tools/soporte.mjs <correo o parte del correo>\n`);
}

// ── Radiografía ──────────────────────────────────────────────────────────────
async function radiografia(busqueda) {
  const b = esc(busqueda.toLowerCase());
  const encontrados = await sql(busqueda.startsWith('user_')
    ? `select * from public.users where id = '${esc(busqueda)}' limit 5;`
    : `select * from public.users where lower(email) like '%${b}%' or lower(coalesce(name,'')) like '%${b}%' limit 5;`);

  if (!encontrados.length) { console.error(`\n  Ninguna cuenta coincide con «${busqueda}».\n`); process.exit(1); }
  if (encontrados.length > 1) {
    console.log('\n  Varias cuentas coinciden; concreta:\n');
    encontrados.forEach((u) => console.log(`   ${u.id}  ${u.email}`));
    console.log();
    process.exit(0);
  }

  const u = encontrados[0];
  const id = esc(u.id);
  const avisos = [];
  const avisar = (nivel, texto) => avisos.push({ nivel, texto });

  const [equipo, fuentes, pipelines, canales, plataformas, autos, perfiles, leads, tareas, paginas, campanas] = await Promise.all([
    sql(`select member_name, member_email, role, status, member_user_id from public.team_members where owner_user_id = '${id}';`),
    sql(`select name, token, active, tipo, submissions, last_submission_at, pipeline_id, client_id from public.lead_forms where user_id = '${id}' order by created_at;`),
    sql(`select p.id, p.name, p.is_default, p.client_id,
           (select count(*) from public.leads l where l.pipeline_id = p.id and l.deleted_at is null) as leads
         from public.pipelines p where p.user_id = '${id}' order by p.position;`),
    sql(`select channel, channel_name, is_active, agent_id from public.channel_connections where user_id = '${id}';`),
    sql(`select platform, account_name, token_expires_at from public.platform_connections where user_id = '${id}';`),
    sql(`select name, active, "trigger", (select count(*) from public.automation_logs g where g.automation_id = a.id) as ejecuciones from public.automations a where a.user_id = '${id}';`),
    sql(`select agent_key from public.user_profiles where user_id = '${id}';`),
    sql(`select count(*) filter (where deleted_at is null) as activos,
                count(*) filter (where deleted_at is not null) as papelera,
                count(*) filter (where deleted_at is null and assigned_to is null
                     and closed_at is null and stage not in ('ganado','perdido')) as sin_asignar,
                count(*) filter (where deleted_at is null and pipeline_id is null) as sin_pipeline,
                count(*) filter (where deleted_at is null and updated_at < now() - interval '30 days') as quietos,
                max(created_at) as ultimo
         from public.leads where user_id = '${id}';`),
    sql(`select count(*) filter (where pendiente and due_at < now()) as vencidas,
                count(*) filter (where pendiente and due_at < now() and not cerrado) as vencidas_vivas,
                count(*) filter (where pendiente and due_at >= now()) as futuras,
                count(*) filter (where pendiente and cerrado) as huerfanas
         from (select a.due_at,
                      not coalesce(a.done, false) and a.cancelled_at is null as pendiente,
                      (l.closed_at is not null or l.stage in ('ganado','perdido')) as cerrado
               from public.activities a left join public.leads l on l.id = a.lead_id
               where a.user_id = '${id}') t;`),
    sql(`select title, slug, published, visits from public.landings where user_id = '${id}';`),
    sql(`select name, status, channel, sent_at from public.campaigns where user_id = '${id}' order by created_at desc limit 5;`),
  ]);

  const L = leads[0] || {}, T = tareas[0] || {};
  const limite = LIMITES_PLAN[u.plan] || 10;
  const claves = new Set((perfiles || []).map((p) => p.agent_key));

  // ── Impresión ──────────────────────────────────────────────────────────────
  const titulo = (t) => console.log(`\n  ── ${t} ${'─'.repeat(Math.max(0, 60 - t.length))}`);
  console.log(`\n  ${u.name || u.email}`);
  console.log(`  ${u.id}   ${u.email}`);
  console.log(`  plan ${u.plan}${u.status ? ' · ' + u.status : ''} · alta ${dia(u.created_at)}${u.trial_ends_at ? ' · prueba hasta ' + dia(u.trial_ends_at) : ''}`);

  titulo('LEADS');
  console.log(`  ${L.activos} activos · ${L.papelera} en papelera · límite del plan ${limite}`);
  console.log(`  ${L.sin_asignar} sin comercial · ${L.sin_pipeline} sin tablero · ${L.quietos} sin tocar hace +30 días`);
  console.log(`  último lead: ${L.ultimo ? dia(L.ultimo) + ` (hace ${dias(L.ultimo)} días)` : 'ninguno'}`);

  titulo('EQUIPO');
  if (!equipo.length) console.log('  (sin equipo: solo el dueño)');
  equipo.forEach((m) => console.log(`  ${(m.member_name || m.member_email || '—').padEnd(26)} ${String(m.role).padEnd(9)} ${m.status}${m.member_user_id ? '' : '  ← invitación sin aceptar'}`));

  titulo('FUENTES DE LEADS');
  if (!fuentes.length) console.log('  (ninguna)');
  fuentes.forEach((f) => console.log(
    `  ${(f.name || '—').slice(0, 30).padEnd(32)} ${f.active ? 'activo ' : 'PAUSADO'} ${String(f.submissions || 0).padStart(4)} envíos  último ${dia(f.last_submission_at)}`));

  titulo('TABLEROS');
  if (!pipelines.length) console.log('  (ninguno: los leads no se ven en ningún tablero)');
  pipelines.forEach((p) => console.log(`  ${p.name.padEnd(28)} ${String(p.leads).padStart(5)} leads${p.is_default ? '   (principal)' : ''}${p.client_id ? '   cliente ' + p.client_id : ''}`));

  titulo('CANALES Y CONEXIONES');
  if (!canales.length && !plataformas.length) console.log('  (ninguna)');
  canales.forEach((c) => console.log(`  ${String(c.channel).padEnd(14)} ${c.channel_name || ''} ${c.is_active ? 'activo' : 'INACTIVO'}`));
  plataformas.forEach((p) => {
    const vencido = p.token_expires_at && new Date(p.token_expires_at) < new Date();
    console.log(`  ${String(p.platform).padEnd(14)} ${p.account_name || ''} ${vencido ? 'TOKEN VENCIDO' : 'ok'}`);
    if (vencido) avisar('alto', `La conexión de ${p.platform} está vencida: hay que reconectarla.`);
  });

  titulo('AUTOMATIZACIONES');
  if (!autos.length) console.log('  (ninguna)');
  autos.forEach((a) => console.log(`  ${(a.name || '—').slice(0, 34).padEnd(36)} ${a.active ? 'activa  ' : 'apagada '} ${String(a.trigger || '').padEnd(16)} ${a.ejecuciones} ejecuciones`));

  titulo('TAREAS');
  console.log(`  ${T.vencidas} vencidas sin completar · ${T.futuras} programadas${Number(T.huerfanas) ? ` · ${T.huerfanas} sobre leads ya cerrados` : ''}`);

  if (paginas.length) {
    titulo('PÁGINAS DE ATERRIZAJE');
    paginas.forEach((p) => console.log(`  ${(p.title || '—').slice(0, 34).padEnd(36)} ${p.published ? 'publicada' : 'borrador '} ${String(p.visits || 0).padStart(5)} visitas`));
  }
  if (campanas.length) {
    titulo('ÚLTIMAS CAMPAÑAS');
    campanas.forEach((c) => console.log(`  ${(c.name || '—').slice(0, 34).padEnd(36)} ${String(c.channel || '').padEnd(9)} ${String(c.status).padEnd(11)} ${c.sent_at ? 'enviada ' + dia(c.sent_at) : ''}`));
  }

  // ── Desajustes: lo que de verdad ha generado tickets ───────────────────────
  const comerciales = equipo.filter((m) => m.status === 'active' && m.member_user_id);
  const fuentesVivas = fuentes.filter((f) => f.active);

  if (!fuentesVivas.length && !canales.filter((c) => c.is_active).length) {
    avisar('alto', 'No hay ninguna fuente de leads activa: ni formularios ni canales. No puede entrar nada.');
  }
  if (!pipelines.length) {
    avisar('alto', 'La cuenta no tiene ningún tablero: los leads existen pero no se ven en el pipeline.');
  }
  if (Number(L.sin_pipeline) > 0) {
    avisar('alto', `${L.sin_pipeline} lead(s) sin tablero: existen en la base pero no aparecen en ninguna vista de pipeline.`);
  }
  if (comerciales.length && Number(L.sin_asignar) > 0) {
    avisar('medio', `${L.sin_asignar} lead(s) sin comercial asignado, habiendo ${comerciales.length} en el equipo.`);
  }
  if (equipo.some((m) => !m.member_user_id && m.status !== 'revoked')) {
    avisar('medio', 'Hay invitaciones de equipo sin aceptar: esa persona no ve nada todavía.');
  }
  if (!claves.has('__assign_rules__') && comerciales.length) {
    avisar('medio', 'Hay equipo pero el reparto automático nunca se configuró: los leads llegan sin dueño.');
  }
  if (Number(T.huerfanas) > 0) {
    avisar('medio', `${T.huerfanas} tarea(s) pendientes sobre leads YA CERRADOS. Desde el 01-09-2026 se anulan solas al cerrar el lead; estas son de antes y hay que limpiarlas.`);
  }
  // Las huérfanas NO son un subconjunto de las vencidas —hay huérfanas con
  // fecha futura—, así que restarlas daba negativos. Se cuenta cada cosa.
  if (Number(T.vencidas_vivas) > 0) {
    avisar('medio', `${T.vencidas_vivas} tarea(s) de seguimiento vencidas sobre leads todavía vivos.`);
  }
  if (limite && Number(L.activos) / limite >= 0.8) {
    avisar(Number(L.activos) >= limite ? 'alto' : 'medio',
      `La base va al ${Math.round((L.activos / limite) * 100)}% de su capacidad (${L.activos} de ${limite}).`);
  }
  if (L.ultimo && dias(L.ultimo) > 14) {
    avisar('medio', `Hace ${dias(L.ultimo)} días que no entra un lead. Si el cliente dice que "no le llegan", empieza por aquí.`);
  }
  if (u.plan === 'trial' && u.trial_ends_at && new Date(u.trial_ends_at) < new Date()) {
    avisar('alto', 'La prueba venció y la cuenta sigue en plan trial.');
  }
  fuentes.filter((f) => f.active && f.submissions > 0 && f.last_submission_at && dias(f.last_submission_at) > 30)
    .forEach((f) => avisar('info', `La fuente «${f.name}» lleva ${dias(f.last_submission_at)} días sin recibir nada.`));

  titulo('DESAJUSTES');
  if (!avisos.length) console.log('  Ninguno. La configuración de la cuenta es coherente.');
  const orden = { alto: 0, medio: 1, info: 2 };
  avisos.sort((a, b) => orden[a.nivel] - orden[b.nivel])
    .forEach((a) => console.log(`  [${a.nivel.toUpperCase().padEnd(5)}] ${a.texto}`));
  console.log();
}

const arg = process.argv[2];
await (arg ? radiografia(arg) : listar());

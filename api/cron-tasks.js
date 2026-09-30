// api/cron-tasks.js — resumen diario de tareas.
//
// Cada mañana, a cada comercial le llega lo que tiene para hoy y lo que se le
// pasó. Al dueño de la cuenta le llega además lo que no tiene dueño.
//
// Regla de oro: si no hay nada pendiente, no se manda nada. Un correo diario
// vacío se convierte en un correo que nadie abre.

import { emailHtml, RESPONDER_A } from './_email-layout.js';
import { enviarResendLote } from './_correo.js';
import { periodoDe } from './_una-vez.js';
import { latir } from './_latido.js';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

function sb() {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  };
}

function esc(s) {
  return String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}

// El enlace de «Ya la hice». Firmado, porque abre una acción sin pedir sesión;
// y con caducidad, porque un correo de hace tres meses no debería seguir
// moviendo el CRM de nadie. Misma firma que los enlaces de reseñas: el HMAC
// está repetido a propósito, aquí en Node y allá en edge, porque no comparten
// entorno. Si cambia, cambia en los dos.
const LINK_SECRET = process.env.LINK_SECRET || process.env.CRON_SECRET || '';
const DIAS_VALIDEZ = 14;

async function enlaceHecha(actividadId, userId) {
  if (!LINK_SECRET) return null;
  const { createHmac } = await import('node:crypto');
  const exp = Math.floor(Date.now() / 1000) + DIAS_VALIDEZ * 86400;
  const datos = [actividadId, userId, exp].join('|');
  const mac = createHmac('sha256', LINK_SECRET).update(datos).digest('hex').slice(0, 32);
  return 'https://app.acuarius.app/api/tarea?t=' + encodeURIComponent(datos + '.' + mac);
}

async function filas(items) {
  const trozos = await Promise.all(items.map(async t => {
    const cuando = t.due_at
      ? new Date(t.due_at).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : 'Sin fecha';
    const enlace = await enlaceHecha(t.id, t.user_id);
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">
        <strong>${esc(t.title || 'Tarea')}</strong><br>
        <span style="color:#666;font-size:13px">${esc(t.lead?.name || 'Sin lead')}${t.lead?.phone ? ' · ' + esc(t.lead.phone) : ''}</span>
        ${enlace ? `<br><a href="${enlace}" style="color:#1E2BCC;font-size:12.5px;font-weight:600;text-decoration:none">Ya la hice &rarr;</a>` : ''}
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;color:#666;font-size:13px;white-space:nowrap">${esc(cuando)}</td>
    </tr>`;
  }));
  return trozos.join('');
}

// Un lead cerrado —ganado o perdido— ya no necesita seguimiento. Las claves
// 'ganado' y 'perdido' son reservadas del sistema y ningun pipeline puede
// renombrarlas, pero un cliente puede haber creado etapas propias de cierre, y
// el modal de cierre sella closed_at: cualquiera de las dos cosas basta.
const ETAPAS_CERRADAS = ['ganado', 'perdido', 'won', 'lost', 'cerrado', 'descartado'];
function leadCerrado(lead) {
  if (!lead) return false;
  if (lead.closed_at) return true;
  return ETAPAS_CERRADAS.includes(String(lead.stage || '').toLowerCase());
}

// El registro de errores, a mano.
//
// La nota que había aquí decía que `api/_registro-errores.js` «no se puede
// importar desde una función Node porque rompió el build una vez». El
// 28-09-2026 se comprobó desplegando y NO es cierto: `api/cron-retention.js`
// lo importa estáticamente desde Node y corre cada día, y las doce funciones
// Node de la API lo usan por `api/_sesion.js`. Lo que rompiera aquella vez
// era otra cosa.
//
// Se deja a mano igual, porque el RPC es el mismo y cambiarlo sin motivo no
// arregla nada — pero que la nota no vuelva a frenar a nadie. Antes, un resumen que no salía no dejaba ni una huella: el
// resumen del cron se lo queda Vercel y nadie lo lee.
async function anotar(mensaje, detalle, usuario) {
  try {
    console.error('[cron] cron-tasks:', mensaje, detalle || '');
    if (!SUPABASE_URL || !SUPABASE_KEY) return;
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/registrar_error`, {
      method: 'POST',
      headers: sb(),
      body: JSON.stringify({
        p_firma: 'cron-tasks-' + String(mensaje).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60),
        p_origen: 'cron',
        p_donde: 'cron-tasks',
        p_mensaje: String(mensaje).slice(0, 500),
        p_detalle: detalle ? String(detalle).slice(0, 4000) : null,
        p_usuario: usuario || null,
      }),
    });
  } catch {}
}

// Arma el correo de una persona; no lo envía. Se envían de cien en cien por
// el endpoint de lotes de Resend: uno a uno, a ~2 por segundo que acepta
// Resend, 600 personas eran 300 s y el cron tiene 60 (30-09-2026).
export async function armarCorreo(to, vencidas, hoy) {
  const total = vencidas.length + hoy.length;
  const asunto = vencidas.length
    ? `${vencidas.length} tarea${vencidas.length > 1 ? 's' : ''} vencida${vencidas.length > 1 ? 's' : ''} y ${hoy.length} para hoy`
    : `${hoy.length} tarea${hoy.length > 1 ? 's' : ''} para hoy`;

  const bloque = async (titulo, items, color) => items.length ? `
    <h3 style="color:${color};font-size:15px;margin:22px 0 8px">${titulo} (${items.length})</h3>
    <table style="width:100%;border-collapse:collapse">${await filas(items)}</table>` : '';
  const cuerpo = (await bloque('Vencidas', vencidas, '#B91C1C')) + (await bloque('Para hoy', hoy, '#1E2BCC'));

  return {
    from: 'Acuarius <crm@app.acuarius.app>', reply_to: RESPONDER_A,
    to,
    subject: `${asunto} — Acuarius`,
    html: emailHtml({
      titulo: 'Tu día en el CRM',
      intro: `Tienes ${total} pendiente${total > 1 ? 's' : ''}.`,
      preheader: asunto,
      cuerpo,
      cta: { texto: 'Abrir mis tareas', url: 'https://app.acuarius.app/crm/tareas' },
    }),
  };
}

// Todas las filas, de mil en mil: PostgREST no devuelve más de mil aunque se
// pida limit=5000. Con las vencidas acumulándose, las primeras mil (las más
// viejas) tapaban a las cuentas con tareas recientes, que se quedaban sin
// resumen sin ningún aviso. Un fallo se lanza: nunca es «no hay nada».
export async function leerTodas(ruta, techo = 100000) {
  const filas = [];
  for (let desde = 0; desde < techo; desde += 1000) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${ruta}&limit=1000&offset=${desde}`, { headers: sb() });
    if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const lote = await r.json();
    if (!Array.isArray(lote)) throw new Error('respuesta que no es una lista');
    filas.push(...lote);
    if (lote.length < 1000) return filas;
  }
  throw new Error('más de ' + techo + ' filas en ' + ruta.split('?')[0]);
}

// De `n` en `n` a la vez: las cuentas se arman en paralelo, sin lanzar
// doscientas peticiones de golpe.
async function enParalelo(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k]); }
  }));
}

// La bandeja de cada persona de una cuenta, con su correo. Lanza si no puede
// leer lo que necesita: un resumen al que le faltan las tareas con lead es
// peor que ninguno, porque parece completo.
async function bandejasDeCuenta(userId, tareas) {
  const ids = Array.from(new Set(tareas.map(t => t.lead_id).filter(Boolean)));
  const porId = {};
  for (let i = 0; i < ids.length; i += 150) {   // la URL con cientos de ids falla
    const r = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=in.(${ids.slice(i, i + 150).join(',')})&select=id,name,phone,assigned_to,deleted_at,stage,closed_at`, { headers: sb() });
    if (!r.ok) throw new Error(`no se pudieron leer los leads (Supabase ${r.status})`);
    for (const l of await r.json()) porId[l.id] = l;
  }

  // A quién le toca cada tarea: al dueño del lead, o al dueño de la cuenta
  const bandejas = {};
  for (const t of tareas) {
    const lead = t.lead_id ? porId[t.lead_id] : null;
    if (t.lead_id && (!lead || lead.deleted_at)) continue;
    if (lead && leadCerrado(lead)) continue;
    const destinatario = lead?.assigned_to || userId;
    (bandejas[destinatario] = bandejas[destinatario] || []).push({ ...t, lead });
  }

  // Correo de cada uno: los miembros por su email del equipo, el dueño por Clerk
  const rm = await fetch(
    `${SUPABASE_URL}/rest/v1/team_members?owner_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=member_user_id,member_email`,
    { headers: sb() }
  );
  if (!rm.ok) throw new Error(`no se pudo leer el equipo (Supabase ${rm.status})`);
  const emailDe = {};
  for (const m of await rm.json()) if (m.member_user_id) emailDe[m.member_user_id] = m.member_email;
  if (bandejas[userId] && !emailDe[userId]) {
    emailDe[userId] = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
      headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
    }).then(r => (r.ok ? r.json() : null))
      .then(u => u?.email_addresses?.[0]?.email_address || null)
      .catch(() => null);
  }
  return { bandejas, emailDe };
}

// Tiempo para armar bandejas antes de ponerse a enviar. El cron corre a las
// 12:00, 12:10 y 12:20 (vercel.json): lo que no alcance una corrida lo manda
// la siguiente, y nadie lo recibe dos veces (cron_envios).
export const TOPE_ARMADO_MS = 35 * 1000;

export default async function handler(req, res) {
  const auth = req.headers?.authorization || '';
  const secreto = req.headers?.['x-acuarius-secret'];
  if (auth !== `Bearer ${process.env.CRON_SECRET}` && secreto !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  // Se marca la ENTRADA, no solo la salida.
  //
  // El 24-09-2026 este cron volvió a no mandar nada y no había latido — y un
  // latido que solo se escribe al terminar no distingue «Vercel no lo llamó»
  // de «lo llamó y se murió a mitad». Son dos problemas distintos con arreglos
  // distintos, y sin esta marca no hay forma de saber cuál es.
  //
  // Si mañana queda un latido con `empezo` y sin resultado, es lo segundo.
  await latir('cron-tasks', { empezo: new Date().toISOString() });

  // Y toda salida deja el suyo, incluidas las malas. Ver api/_latido.js.
  const responder = async (estado, cuerpo, fallo) => {
    await latir('cron-tasks', cuerpo, fallo);
    return res.status(estado).json(cuerpo);
  };

  const resumen = { cuentas: 0, correos: 0, fallidos: [], errores: [], ya_enviados: 0, sin_tiempo: 0 };
  const ahora = Date.now();
  // CRON_TAREAS_TOPE_MS solo existe para la prueba: en producción no está.
  const hasta = ahora + (Number(process.env.CRON_TAREAS_TOPE_MS) || TOPE_ARMADO_MS);
  const finDeHoy = new Date(); finDeHoy.setHours(23, 59, 59, 999);

  // Solo las cuentas que tienen algo pendiente hasta el final del día.
  //
  // «No contestó la base» y «hoy nadie tiene nada» NO son lo mismo: el
  // 23-09-2026 un fallo convertido en lista vacía dejó a los cinco asesores de
  // Certain sin su aviso con un 200 «todo bien». Un fallo se queda como fallo:
  // se anota y se devuelve 500, que Vercel reintenta y el aviso de errores
  // enseña.
  let pendientes;
  try {
    pendientes = await leerTodas(
      `activities?done=is.false&cancelled_at=is.null&due_at=lte.${encodeURIComponent(finDeHoy.toISOString())}` +
      `&select=id,user_id,lead_id,title,type,due_at&order=due_at.asc,id.asc`
    );
  } catch (e) {
    await anotar('el resumen diario de tareas no se pudo armar: la base no contestó',
      e?.message || String(e), null);
    return responder(500, { error: 'No se pudo leer las tareas pendientes.', detalle: e?.message }, e?.message || 'la base no contestó');
  }
  if (!pendientes.length) return responder(200, { ...resumen, sin_pendientes: true });

  const porCuenta = {};
  pendientes.forEach(t => { (porCuenta[t.user_id] = porCuenta[t.user_id] || []).push(t); });

  // 1. Las bandejas, ocho cuentas a la vez y con reloj.
  const sobres = [];   // { quien, userId, to, vencidas, hoy }
  await enParalelo(Object.keys(porCuenta), 8, async (userId) => {
    if (Date.now() >= hasta) { resumen.sin_tiempo++; return; }
    try {
      const { bandejas, emailDe } = await bandejasDeCuenta(userId, porCuenta[userId]);
      for (const quien of Object.keys(bandejas)) {
        const suyas = bandejas[quien];
        const vencidas = suyas.filter(t => t.due_at && new Date(t.due_at).getTime() < ahora);
        const hoy = suyas.filter(t => !t.due_at || new Date(t.due_at).getTime() >= ahora);
        if (!vencidas.length && !hoy.length) continue;
        sobres.push({ quien, userId, to: emailDe[quien], vencidas, hoy });
      }
      resumen.cuentas++;
    } catch (e) {
      resumen.errores.push(`${userId}: ${e.message}`);
      await anotar('la cuenta falló al armar su resumen de tareas', e?.stack || e?.message, userId);
    }
  });

  // 2. Quién lo recibió ya hoy (una vez al día por persona; ver _una-vez.js).
  const clave = (quien) => `tareas:${quien}:${periodoDe('dia')}`;
  const hechos = new Set();
  try {
    const claves = sobres.map(x => clave(x.quien));
    for (let i = 0; i < claves.length; i += 150) {
      const lote = claves.slice(i, i + 150).map(c => '"' + c + '"').join(',');
      const r = await fetch(`${SUPABASE_URL}/rest/v1/cron_envios?clave=in.(${encodeURIComponent(lote)})&select=clave`, { headers: sb() });
      if (!r.ok) throw new Error(`Supabase ${r.status}`);
      for (const f of await r.json()) hechos.add(f.clave);
    }
  } catch (e) {
    // Sin saber quién lo recibió ya, enviar podría duplicar el correo de media
    // plataforma: se corta y lo retoma la siguiente corrida.
    await anotar('el resumen diario no pudo comprobar quién lo recibió ya', e?.message, null);
    return responder(500, { ...resumen, error: 'No se pudo leer cron_envios.' }, e?.message);
  }
  const porEnviar = [];
  for (const x of sobres) {
    if (hechos.has(clave(x.quien))) { resumen.ya_enviados++; continue; }
    if (!x.to) {
      resumen.fallidos.push({ quien: x.quien, motivo: 'esa persona no tiene correo en el equipo' });
      await anotar('el resumen diario de tareas no salió: esa persona no tiene correo en el equipo', `destinatario ${x.quien}`, x.userId);
      continue;
    }
    porEnviar.push(x);
  }

  // 3. De cien en cien. Se marca SOLO lo que Resend aceptó: un lote que falla
  // se reintenta en la corrida siguiente en vez de perderse.
  if (porEnviar.length && !RESEND_API_KEY) {
    return responder(500, { ...resumen, error: 'RESEND_API_KEY no configurada' }, 'RESEND_API_KEY no configurada');
  }
  for (let i = 0; i < porEnviar.length; i += 100) {
    const lote = porEnviar.slice(i, i + 100);
    const cuerpos = await Promise.all(lote.map(x => armarCorreo(x.to, x.vencidas, x.hoy)));
    const r = await enviarResendLote('cron-tasks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpos),
    });
    if (!r.ok) {
      const det = await r.text().catch(() => '');
      for (const x of lote) resumen.fallidos.push({ quien: x.quien, motivo: `Resend ${r.status}` });
      await anotar('el resumen diario de tareas no salió: Resend ' + r.status, `${lote.length} personas · ${det.slice(0, 400)}`, null);
      continue;
    }
    resumen.correos += lote.length;
    await fetch(`${SUPABASE_URL}/rest/v1/cron_envios?on_conflict=clave`, {
      method: 'POST',
      headers: { ...sb(), Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(lote.map(x => ({ clave: clave(x.quien), dia: new Date().toISOString().slice(0, 10) }))),
    }).catch(e => anotar('no se pudo marcar el resumen como enviado', e?.message, null));
  }

  if (resumen.sin_tiempo) {
    await anotar('el resumen diario no alcanzó a todas las cuentas en esta corrida',
      `${resumen.sin_tiempo} cuentas quedan para la siguiente (12:10 o 12:20 UTC)`, null);
  }

  const problemas = [...resumen.errores, ...resumen.fallidos.map(f => `${f.quien}: ${f.motivo}`)];
  return responder(200, resumen, problemas.length ? problemas.join(' · ').slice(0, 200) : null);
}

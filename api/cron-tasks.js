// api/cron-tasks.js — resumen diario de tareas.
//
// Cada mañana, a cada comercial le llega lo que tiene para hoy y lo que se le
// pasó. Al dueño de la cuenta le llega además lo que no tiene dueño.
//
// Regla de oro: si no hay nada pendiente, no se manda nada. Un correo diario
// vacío se convierte en un correo que nadie abre.

import { emailHtml, RESPONDER_A } from './_email-layout.js';
import { enviarResend } from './_correo.js';
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

// El registro de errores, a mano. api/_registro-errores.js no se puede importar
// desde aquí —esta función es Node y ese módulo rompió el build una vez—, pero
// el RPC es el mismo, así que estos fallos salen en el aviso diario como
// cualquier otro. Antes, un resumen que no salía no dejaba ni una huella: el
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

// Devuelve el motivo en vez de un booleano: «no salió» sin decir por qué es lo
// que dejó a un equipo entero sin su resumen sin que nadie pudiera verlo.
async function enviar(to, vencidas, hoy) {
  if (!RESEND_API_KEY) return { ok: false, motivo: 'RESEND_API_KEY no configurada' };
  if (!to) return { ok: false, motivo: 'esa persona no tiene correo en el equipo' };
  const total = vencidas.length + hoy.length;
  const asunto = vencidas.length
    ? `${vencidas.length} tarea${vencidas.length > 1 ? 's' : ''} vencida${vencidas.length > 1 ? 's' : ''} y ${hoy.length} para hoy`
    : `${hoy.length} tarea${hoy.length > 1 ? 's' : ''} para hoy`;

  const bloque = async (titulo, items, color) => items.length ? `
    <h3 style="color:${color};font-size:15px;margin:22px 0 8px">${titulo} (${items.length})</h3>
    <table style="width:100%;border-collapse:collapse">${await filas(items)}</table>` : '';
  const cuerpo = (await bloque('Vencidas', vencidas, '#B91C1C')) + (await bloque('Para hoy', hoy, '#1E2BCC'));

  const res = await enviarResend('cron-tasks', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
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
    }),
  });
  if (res.ok) return { ok: true };
  const cuerpoErr = await res.text().catch(() => '');
  return { ok: false, motivo: `Resend ${res.status}`, detalle: cuerpoErr.slice(0, 500) };
}

export default async function handler(req, res) {
  const auth = req.headers?.authorization || '';
  const secreto = req.headers?.['x-acuarius-secret'];
  if (auth !== `Bearer ${process.env.CRON_SECRET}` && secreto !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const resumen = { cuentas: 0, correos: 0, fallidos: [], errores: [] };
  const ahora = Date.now();
  const finDeHoy = new Date(); finDeHoy.setHours(23, 59, 59, 999);

  // Solo las cuentas que tienen algo pendiente hasta el final del día
  const pendientes = await fetch(
    `${SUPABASE_URL}/rest/v1/activities?done=is.false&cancelled_at=is.null&due_at=lte.${encodeURIComponent(finDeHoy.toISOString())}&select=*&order=due_at.asc&limit=5000`,
    { headers: sb() }
  ).then(r => (r.ok ? r.json() : [])).catch(() => []);
  if (!pendientes?.length) return res.status(200).json(resumen);

  const porCuenta = {};
  pendientes.forEach(t => { (porCuenta[t.user_id] = porCuenta[t.user_id] || []).push(t); });

  for (const userId of Object.keys(porCuenta)) {
    try {
      const tareas = porCuenta[userId];
      const ids = Array.from(new Set(tareas.map(t => t.lead_id).filter(Boolean)));
      const leads = ids.length ? await fetch(
        `${SUPABASE_URL}/rest/v1/leads?id=in.(${ids.join(',')})&select=id,name,phone,assigned_to,deleted_at,stage,closed_at`,
        { headers: sb() }
      ).then(r => (r.ok ? r.json() : [])).catch(() => []) : [];
      const porId = {};
      (leads || []).forEach(l => { porId[l.id] = l; });

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
      const miembros = await fetch(
        `${SUPABASE_URL}/rest/v1/team_members?owner_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=member_user_id,member_email`,
        { headers: sb() }
      ).then(r => (r.ok ? r.json() : [])).catch(() => []);
      const emailDe = {};
      (miembros || []).forEach(m => { if (m.member_user_id) emailDe[m.member_user_id] = m.member_email; });
      if (!emailDe[userId]) {
        emailDe[userId] = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
          headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
        }).then(r => (r.ok ? r.json() : null))
          .then(u => u?.email_addresses?.[0]?.email_address || null)
          .catch(() => null);
      }

      for (const quien of Object.keys(bandejas)) {
        const suyas = bandejas[quien];
        const vencidas = suyas.filter(t => t.due_at && new Date(t.due_at).getTime() < ahora);
        const hoy = suyas.filter(t => !t.due_at || new Date(t.due_at).getTime() >= ahora);
        if (!vencidas.length && !hoy.length) continue;
        const r = await enviar(emailDe[quien], vencidas, hoy);
        if (r.ok) { resumen.correos++; continue; }
        resumen.fallidos.push({ quien, motivo: r.motivo });
        await anotar(
          'el resumen diario de tareas no salió: ' + r.motivo,
          `destinatario ${quien} · ${vencidas.length} vencidas · ${hoy.length} para hoy · ${r.detalle || ''}`,
          userId
        );
      }
      resumen.cuentas++;
    } catch (e) {
      resumen.errores.push(`${userId}: ${e.message}`);
      await anotar('la cuenta falló al armar su resumen de tareas', e?.stack || e?.message, userId);
    }
  }

  return res.status(200).json(resumen);
}

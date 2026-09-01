// api/cron-tasks.js — resumen diario de tareas.
//
// Cada mañana, a cada comercial le llega lo que tiene para hoy y lo que se le
// pasó. Al dueño de la cuenta le llega además lo que no tiene dueño.
//
// Regla de oro: si no hay nada pendiente, no se manda nada. Un correo diario
// vacío se convierte en un correo que nadie abre.

import { emailHtml, RESPONDER_A } from './_email-layout.js';
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

function filas(items) {
  return items.map(t => {
    const cuando = t.due_at
      ? new Date(t.due_at).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : 'Sin fecha';
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">
        <strong>${esc(t.title || 'Tarea')}</strong><br>
        <span style="color:#666;font-size:13px">${esc(t.lead?.name || 'Sin lead')}${t.lead?.phone ? ' · ' + esc(t.lead.phone) : ''}</span>
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;color:#666;font-size:13px;white-space:nowrap">${esc(cuando)}</td>
    </tr>`;
  }).join('');
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

async function enviar(to, vencidas, hoy) {
  if (!RESEND_API_KEY || !to) return false;
  const total = vencidas.length + hoy.length;
  const asunto = vencidas.length
    ? `${vencidas.length} tarea${vencidas.length > 1 ? 's' : ''} vencida${vencidas.length > 1 ? 's' : ''} y ${hoy.length} para hoy`
    : `${hoy.length} tarea${hoy.length > 1 ? 's' : ''} para hoy`;

  const bloque = (titulo, items, color) => items.length ? `
    <h3 style="color:${color};font-size:15px;margin:22px 0 8px">${titulo} (${items.length})</h3>
    <table style="width:100%;border-collapse:collapse">${filas(items)}</table>` : '';

  const res = await fetch('https://api.resend.com/emails', {
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
        cuerpo: bloque('Vencidas', vencidas, '#B91C1C') + bloque('Para hoy', hoy, '#1E2BCC'),
        cta: { texto: 'Abrir mis tareas', url: 'https://app.acuarius.app/crm/tareas' },
      }),
    }),
  });
  return res.ok;
}

export default async function handler(req, res) {
  const auth = req.headers?.authorization || '';
  const secreto = req.headers?.['x-acuarius-secret'];
  if (auth !== `Bearer ${process.env.CRON_SECRET}` && secreto !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const resumen = { cuentas: 0, correos: 0, errores: [] };
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
        if (await enviar(emailDe[quien], vencidas, hoy)) resumen.correos++;
      }
      resumen.cuentas++;
    } catch (e) {
      resumen.errores.push(`${userId}: ${e.message}`);
    }
  }

  return res.status(200).json(resumen);
}

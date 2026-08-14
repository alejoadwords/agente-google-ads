// api/_aviso-nota.js
// Avisa por correo cuando alguien del equipo escribe una nota interna.
//
// Sin esto, una nota es un mensaje en una botella: solo la ve quien entre a esa
// conversación. Si un comercial escribe «ya lo llamé, pide descuento», quien
// atienda después lo descubre por casualidad — o no lo descubre.
//
// Todo aquí es silencioso a propósito: que falle el correo NO puede impedir que
// la nota se guarde. La nota es el dato; el aviso es una cortesía.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function sb() {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  };
}

function escapar(t) {
  return String(t || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// A quién le importa esta nota: al que tiene el lead. Si no hay lead o no está
// asignado, al dueño de la cuenta. Nunca a quien la escribió.
async function destinatarios(ownerId, autorId, conv) {
  const quienes = new Set();

  if (conv?.lead_id) {
    const lead = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?id=eq.${conv.lead_id}&select=assigned_to`,
      { headers: sb() }
    ).then(r => (r.ok ? r.json() : [])).then(r => r?.[0]).catch(() => null);
    if (lead?.assigned_to) quienes.add(lead.assigned_to);
  }
  // El dueño se entera de todo lo que pasa en su cuenta.
  quienes.add(ownerId);
  quienes.delete(autorId);   // uno no se avisa a sí mismo
  return [...quienes];
}

async function correosDe(ownerId, ids) {
  const emails = {};
  const miembros = await fetch(
    `${SUPABASE_URL}/rest/v1/team_members?owner_user_id=eq.${encodeURIComponent(ownerId)}&status=eq.active&select=member_user_id,member_email`,
    { headers: sb() }
  ).then(r => (r.ok ? r.json() : [])).catch(() => []);
  (miembros || []).forEach(m => { if (m.member_user_id) emails[m.member_user_id] = m.member_email; });

  // El dueño no está en team_members: su correo vive en Clerk.
  if (ids.includes(ownerId) && !emails[ownerId]) {
    emails[ownerId] = await fetch(`https://api.clerk.com/v1/users/${ownerId}`, {
      headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
    }).then(r => (r.ok ? r.json() : null))
      .then(u => u?.email_addresses?.[0]?.email_address || null)
      .catch(() => null);
  }
  return emails;
}

export async function avisarNota({ ownerId, autorId, autorNombre, conv, texto }) {
  try {
    const key = process.env.RESEND_API_KEY;
    if (!key) return { avisados: 0, motivo: 'sin RESEND_API_KEY' };

    const ids = await destinatarios(ownerId, autorId, conv);
    if (!ids.length) return { avisados: 0 };

    const emails = await correosDe(ownerId, ids);
    const contacto = conv?.contact_name || conv?.contact_phone || 'un contacto';
    const quien = autorNombre || 'Alguien de tu equipo';

    let avisados = 0;
    for (const id of ids) {
      const to = emails[id];
      if (!to) continue;
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Acuarius <crm@app.acuarius.app>',
          to,
          subject: `Nota interna sobre ${contacto}`,
          html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
          <h2 style="color:#111;margin-bottom:4px">${escapar(quien)} dejó una nota</h2>
          <p style="color:#444;margin-top:0">En la conversación con <strong>${escapar(contacto)}</strong>.</p>
          <div style="border-left:3px solid #f59e0b;background:#fffbeb;border-radius:8px;padding:14px 16px;margin:16px 0;color:#111;white-space:pre-wrap">${escapar(texto)}</div>
          <p style="color:#666;font-size:13px">Esta nota es interna: el cliente no la ve.</p>
          <a href="https://app.acuarius.app/conversaciones" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:700">Abrir la conversación</a>
        </div>`,
        }),
      }).catch(() => null);
      if (res?.ok) avisados++;
    }
    return { avisados };
  } catch (e) {
    console.error('avisarNota:', e?.message);
    return { avisados: 0, error: e?.message };
  }
}

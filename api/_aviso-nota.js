// api/_aviso-nota.js
// Avisa por correo cuando alguien del equipo escribe una nota interna.
//
// Sin esto, una nota es un mensaje en una botella: solo la ve quien entre a esa
// conversación. Si un comercial escribe «ya lo llamé, pide descuento», quien
// atienda después lo descubre por casualidad — o no lo descubre.
//
// Todo aquí es silencioso a propósito: que falle el correo NO puede impedir que
// la nota se guarde. La nota es el dato; el aviso es una cortesía.

import { emailHtml, bloque, esc } from './_email-layout.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function sb() {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  };
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

    // La regla vive con las demás de seguimiento: una agencia con mucho volumen
    // puede no querer un correo por cada nota.
    const { getRegla } = await import('./_followup.js');
    const regla = await getRegla(ownerId);
    if (!regla.avisar_notas) return { avisados: 0, motivo: 'apagado' };

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
          html: emailHtml({
            titulo: `${esc(quien)} dejó una nota`,
            intro: `En la conversación con <strong>${esc(contacto)}</strong>.`,
            preheader: String(texto).slice(0, 90),
            // Ámbar, igual que la nota en el inbox: quien la ve ahí la reconoce aquí.
            cuerpo: bloque(`<span style="white-space:pre-wrap">${esc(texto)}</span>`, '#F59E0B'),
            cta: { texto: 'Abrir la conversación', url: 'https://app.acuarius.app/conversaciones' },
            pie: 'Esta nota es interna: el cliente no la ve.',
          }),
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

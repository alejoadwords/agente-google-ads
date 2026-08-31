// api/_aviso-lead-nota.js
// Avisa al comercial cuando la dirección le deja una nota en uno de sus leads.
//
// Es la hermana de _aviso-nota.js (notas del inbox), pero el caso es otro: allí
// el equipo se pasa contexto entre sí; aquí el dueño o un administrador le está
// dando una instrucción concreta a quien lleva el lead. Por eso el destinatario
// no se calcula: es el responsable del lead y nadie más.
//
// Todo aquí es silencioso a propósito. Que falle el correo NO puede impedir que
// la nota se guarde: la nota es el dato, el correo es el mensajero. Pero sí se
// devuelve qué pasó, porque quien la escribe tiene que saber si llegó o no —
// decirle «avisado» cuando nadie recibió nada es la peor forma de fallar.

import { emailHtml, bloque, esc, RESPONDER_A } from './_email-layout.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function sb() {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  };
}

// El correo del destinatario: si es un miembro está en team_members; si es el
// propio dueño (se dejó una nota a sí mismo en un lead suyo) vive en Clerk.
async function correoDe(ownerId, quienId) {
  const m = await fetch(
    `${SUPABASE_URL}/rest/v1/team_members?owner_user_id=eq.${encodeURIComponent(ownerId)}&member_user_id=eq.${encodeURIComponent(quienId)}&status=eq.active&select=member_email,member_name&limit=1`,
    { headers: sb() }
  ).then(r => (r.ok ? r.json() : [])).then(r => r?.[0]).catch(() => null);
  if (m?.member_email) return { email: m.member_email, nombre: m.member_name || null };

  if (quienId === ownerId) {
    const email = await fetch(`https://api.clerk.com/v1/users/${quienId}`, {
      headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
    }).then(r => (r.ok ? r.json() : null))
      .then(u => u?.email_addresses?.[0]?.email_address || null)
      .catch(() => null);
    if (email) return { email, nombre: null };
  }
  return null;
}

export // Una nota puede llevar enlaces escritos como [texto](url) — ver actTexto() en
// public/app.js. Aqui se pintan igual, o el comercial recibe por correo los
// corchetes en crudo. Mismo orden y misma regla: escapar primero, y solo
// http/https, nunca javascript:.
function conEnlaces(txt) {
  let out = esc(String(txt || ''));
  out = out.replace(/\[([^\]\n]{1,120})\]\((\S{1,500}?)\)/g, (todo, etiqueta, url) => {
    const u = url.replace(/&amp;/g, '&').trim();
    if (!/^https?:\/\//i.test(u)) return todo;
    return `<a href="${esc(u)}" style="color:#1E2BCC">${etiqueta}</a>`;
  });
  return out;
}

async function avisarNotaLead({ ownerId, autorNombre, lead, texto, paraId }) {
  try {
    if (!paraId) return { enviado: false, motivo: 'el lead no tiene responsable' };

    const key = process.env.RESEND_API_KEY;
    if (!key) return { enviado: false, motivo: 'correo no configurado' };

    const destino = await correoDe(ownerId, paraId);
    if (!destino?.email) return { enviado: false, motivo: 'el responsable no tiene correo' };

    const quien = autorNombre || 'La dirección';
    const nombreLead = lead?.name || 'un lead';
    const deQuien = lead?.company ? `${nombreLead} · ${lead.company}` : nombreLead;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Acuarius <crm@app.acuarius.app>', reply_to: RESPONDER_A,
        to: destino.email,
        subject: `Nota sobre ${nombreLead}`,
        html: emailHtml({
          titulo: `${esc(quien)} te dejó una nota`,
          intro: `Sobre <strong>${esc(deQuien)}</strong>, un lead que tienes asignado.`,
          preheader: String(texto).slice(0, 90),
          // Azul de marca, no el ámbar de las notas internas del inbox: aquella
          // es contexto entre pares, esta viene de arriba y se lee distinto.
          cuerpo: bloque(`<span style="white-space:pre-wrap">${conEnlaces(texto)}</span>`),
          cta: {
            texto: 'Abrir la ficha del lead',
            url: `https://app.acuarius.app/crm?lead=${encodeURIComponent(lead?.id || '')}`,
          },
          pie: 'La nota queda en el historial de la ficha, junto a las llamadas y los correos.',
        }),
      }),
    }).catch(() => null);

    if (!res?.ok) return { enviado: false, motivo: 'el envío falló' };
    return { enviado: true, a: destino.email };
  } catch (e) {
    console.error('avisarNotaLead:', e?.message);
    return { enviado: false, motivo: e?.message || 'error inesperado' };
  }
}

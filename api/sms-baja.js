// api/sms-baja.js — la baja de SMS desde el enlace corto app.acuarius.app/b/<token>.
//
// En Colombia no podemos recibir respuestas a los SMS (LabsMobile no tiene
// números de recepción), así que un «SALIR» no le llega a nadie. Cada SMS
// termina con este enlace (ver componerSms en _sms.js).
//
// GET pregunta y POST da de baja. No se da de baja con solo abrir: los
// teléfonos abren los enlaces solos para armar la vista previa del mensaje, y
// así la gente quedaría fuera sin haberlo pedido.
//
// La página lleva el nombre del NEGOCIO, no el de Acuarius: quien recibe el
// SMS no nos conoce, conoce a quien le escribió.

export const config = { runtime: 'edge' };

import { leerRemitente, ETIQUETA_BAJA } from './_sms.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const H = { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

async function sb(ruta, init = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

const esc = (t) => String(t || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function pagina({ titulo, texto, boton, ok, estado = 200 }) {
  const html = '<!doctype html><html lang="es"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">' +
    '<title>' + esc(titulo) + '</title></head>' +
    '<body style="font-family:Arial,Helvetica,sans-serif;background:#f6f7fb;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;box-sizing:border-box">' +
    '<div style="background:#fff;border-radius:16px;padding:36px 30px;max-width:420px;width:100%;text-align:center;box-shadow:0 8px 30px rgba(30,43,204,.08)">' +
    (ok === undefined ? '' : '<div style="font-size:36px;margin-bottom:8px;color:' + (ok ? '#10B981' : '#EF4444') + '">' + (ok ? '✓' : '✕') + '</div>') +
    '<h2 style="margin:0 0 10px;color:#1a1a2e;font-size:21px;line-height:1.3">' + esc(titulo) + '</h2>' +
    '<p style="color:#555;margin:0;line-height:1.6;font-size:15px">' + texto + '</p>' +
    (boton ? '<form method="post" style="margin-top:22px"><button type="submit" style="background:#1E2BCC;color:#fff;border:none;border-radius:10px;padding:13px 22px;font-size:15px;font-weight:700;cursor:pointer;width:100%">' + esc(boton) + '</button></form>' : '') +
    '<p style="color:#9aa0b4;font-size:12px;margin:24px 0 0">Mensajes enviados con Acuarius</p>' +
    '</div></body></html>';
  return new Response(html, { status: estado, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export default async function handler(req) {
  const token = new URL(req.url).searchParams.get('t') || '';
  if (!/^[0-9a-f]{8}$/.test(token)) {
    return pagina({ titulo: 'Enlace no válido', texto: 'Revisa que el enlace esté completo, tal como llegó en el mensaje.', ok: false, estado: 404 });
  }
  try {
    const [baja] = await sb(`/sms_bajas?token=eq.${token}&select=token,user_id,lead_id,telefono,usado_at`);
    if (!baja) return pagina({ titulo: 'Enlace no válido', texto: 'Revisa que el enlace esté completo, tal como llegó en el mensaje.', ok: false, estado: 404 });
    const [lead] = baja.lead_id ? await sb(`/leads?id=eq.${baja.lead_id}&select=client_id`) : [];
    const negocio = (await leerRemitente(baja.user_id, lead?.client_id || null)) || 'este negocio';

    if (req.method !== 'POST') {
      if (baja.usado_at) return pagina({ titulo: 'Ya estás fuera de la lista', texto: 'No volverás a recibir mensajes de texto de <b>' + esc(negocio) + '</b>.', ok: true });
      return pagina({
        titulo: '¿No quieres recibir más SMS de ' + negocio + '?',
        texto: 'Si confirmas, <b>' + esc(negocio) + '</b> no te volverá a enviar mensajes de texto a este número.',
        boton: 'Sí, no quiero recibir más SMS',
      });
    }

    // La baja va al número, no solo a la ficha: un mismo móvil puede estar
    // repetido en varios contactos de la cuenta. Se busca por los últimos
    // dígitos en la base y se compara el número entero aquí.
    const diez = String(baja.telefono).slice(-10);
    const candidatos = await sb(`/leads?user_id=eq.${encodeURIComponent(baja.user_id)}&phone=like.*${diez.slice(-4)}&select=id,phone,tags&limit=1000`);
    const suyos = (candidatos || []).filter(l => l.id === baja.lead_id || String(l.phone || '').replace(/\D/g, '').endsWith(diez));
    const ahora = new Date().toISOString();
    for (const l of suyos) {
      if ((l.tags || []).includes(ETIQUETA_BAJA)) continue;
      await sb(`/leads?id=eq.${l.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ tags: [...(l.tags || []), ETIQUETA_BAJA], updated_at: ahora }) });
      await sb('/lead_activities', { method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ lead_id: l.id, user_id: baja.user_id, type: 'nota',
          content: 'Pidió no recibir más SMS desde el enlace de baja del mensaje.', metadata: { sms_baja: true } }) });
    }
    if (!baja.usado_at) {
      await sb(`/sms_bajas?token=eq.${token}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ usado_at: ahora }) });
    }
    return pagina({ titulo: 'Listo, quedaste fuera de la lista', texto: 'No volverás a recibir mensajes de texto de <b>' + esc(negocio) + '</b>.', ok: true });
  } catch (e) {
    console.error('[sms-baja]', e.message);
    return pagina({ titulo: 'No se pudo procesar', texto: 'Hubo un problema de nuestro lado. Intenta de nuevo en un momento.', ok: false, estado: 503 });
  }
}

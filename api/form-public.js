// api/form-public.js
// Cara pública de los formularios de captura:
// GET  ?token= → definición pública (para /form/<token> y el embed)
// POST ?token= → envío: crea/mergea el lead (via _lead-intake) y dispara
//                automatizaciones. Honeypot _hp contra bots (responde ok
//                sin crear nada). Acepta JSON y form-urlencoded.
export const config = { runtime: 'edge' };

import { intakeLead, pick } from './_lead-intake.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'return=representation',
  };
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const token = String(url.searchParams.get('token') || '');
  if (!/^[a-f0-9]{24,64}$/i.test(token)) return jsonResp({ error: 'Formulario no encontrado' }, 404);

  const rows = await fetch(`${SUPABASE_URL}/rest/v1/lead_forms?token=eq.${encodeURIComponent(token)}&select=*&limit=1`, { headers: sbHeaders() }).then(r => r.json()).catch(() => []);
  const form = rows?.[0];
  if (!form) return jsonResp({ error: 'Formulario no encontrado' }, 404);

  if (req.method === 'GET') {
    if (!form.active) return jsonResp({ error: 'Este formulario está pausado' }, 410);
    // Un conector no tiene página propia: solo recoge envíos de una web ajena.
    // Sin esto, /form/<token> pintaría un formulario vacío con un botón inútil.
    if (form.tipo === 'conector') return jsonResp({ error: 'Este enlace no es un formulario' }, 404);
    return jsonResp({
      form: {
        title: form.title || form.name,
        description: form.description,
        button_text: form.button_text || 'Enviar',
        success_message: form.success_message || '¡Gracias! Recibimos tus datos y te contactaremos pronto.',
        redirect_url: form.redirect_url,
        accent_color: form.accent_color || '#2563EB',
        fields: form.fields || [],
      },
    });
  }

  if (req.method !== 'POST') return jsonResp({ error: 'Método no permitido' }, 405);
  if (!form.active) return jsonResp({ error: 'Este formulario está pausado' }, 410);

  let body = {};
  try {
    const text = await req.text();
    // El conector manda JSON como text/plain a propósito: es el único tipo que
    // sendBeacon puede usar sin disparar un preflight de CORS (y sendBeacon no
    // sabe hacer preflight, así que el navegador tiraba el envío en silencio).
    // Por eso se mira el contenido, no la cabecera.
    const t = text.trim();
    if (t.startsWith('{')) body = JSON.parse(t);
    else body = Object.fromEntries(new URLSearchParams(text));
  } catch { return jsonResp({ error: 'Datos inválidos' }, 400); }

  // Honeypot: los bots llenan el campo oculto — responder ok sin crear nada
  if (body._hp) return jsonResp({ ok: true });

  const name = pick(body, 'name', 'nombre', 'full_name', 'fullname');
  const email = pick(body, 'email', 'correo', 'mail');
  const phone = pick(body, 'phone', 'telefono', 'teléfono', 'tel', 'whatsapp', 'celular');
  if (!name && !email && !phone) return jsonResp({ error: 'Faltan datos de contacto' }, 400);

  // Campos custom → nota (todo lo que no mapea al lead)
  const known = new Set(['name', 'nombre', 'full_name', 'fullname', 'email', 'correo', 'mail', 'phone', 'telefono', 'teléfono', 'tel', 'whatsapp', 'celular', 'company', 'empresa', 'negocio', '_hp', 'token', '_page']);
  const extras = Object.entries(body)
    .filter(([k, v]) => !known.has(k.toLowerCase()) && String(v || '').trim())
    .map(([k, v]) => `${k}: ${String(v).trim().slice(0, 200)}`)
    .slice(0, 10);
  const page = pick(body, '_page');
  const noteParts = [...extras];
  if (page) noteParts.push('Página: ' + page.slice(0, 200));

  try {
    const { lead, created } = await intakeLead(form.user_id, form.client_id, {
      name, email, phone,
      company: pick(body, 'company', 'empresa', 'negocio'),
      note: noteParts.join(' · ') || null,
      source: 'formulario',
      sourceLabel: (form.tipo === 'conector' ? 'Web: ' : 'Formulario: ') + form.name,
      tags: form.tags || [],
      // Si esta fuente tiene ejecutivo fijo, manda sobre el reparto por turnos.
      assignedTo: form.assigned_to || null,
      pipelineId: form.pipeline_id || null,
    });
    // Contador de envíos — con await: en edge las promesas sueltas mueren al responder
    await fetch(`${SUPABASE_URL}/rest/v1/lead_forms?id=eq.${form.id}`, {
      method: 'PATCH', headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
      // aviso_silencio_at vuelve a null: si el conector estuvo callado, se avisó
      // y ahora revive, un segundo apagón tiene que volver a avisar.
      body: JSON.stringify({
        submissions: (form.submissions || 0) + 1,
        last_submission_at: new Date().toISOString(),
        aviso_silencio_at: null,
      }),
    }).catch(() => {});
    return jsonResp({ ok: true, created, redirect_url: form.redirect_url || null, success_message: form.success_message || '¡Gracias! Recibimos tus datos y te contactaremos pronto.' });
  } catch (e) {
    console.error('[form-public] error:', e.message);
    return jsonResp({ error: 'No se pudo procesar el envío' }, 500);
  }
}

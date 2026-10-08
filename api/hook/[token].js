// api/hook/[token].js
// Trigger por webhook externo: cada automatización con lanzador "webhook"
// tiene una URL única https://app.acuarius.app/api/hook/<token>.
// Un POST con los datos del lead (JSON o form-urlencoded) crea el lead
// (o reutiliza el existente por correo o teléfono) por intakeLead, igual que
// cualquier otra entrada, y encola el flujo.
// Pensado para formularios de landing, Zapier, Make, Meta Lead Ads, etc.

import { intakeLead, mapExternalPayload, pick as pickIntake, camposDePauta, ambitoDeTrabajo } from '../_lead-intake.js';

// Edge runtime: los imports de módulos compartidos (_lead-intake) se bundlean
// sin problema — en el runtime Node de Vercel ese import rompía el build de
// la función y la ruta caía al catch-all de index.html.
export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function sb(path, method = 'GET', body = null, prefer) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': prefer || 'return=representation',
    },
    body: body ? JSON.stringify(body) : null,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

// Los datos del lead, igual para las dos vías (webhook genérico y webhook de
// una automatización): payload conocido (Hotmart) o campos con alias en
// español/inglés, más los campos de pauta. Se sacan después de mapear para que
// valgan igual con un payload propio que con uno de Hotmart.
function datosDelPayload(body) {
  const mapped = mapExternalPayload(body) || {
    name: pickIntake(body, 'name', 'nombre', 'full_name', 'fullname'),
    email: pickIntake(body, 'email', 'correo', 'mail'),
    phone: pickIntake(body, 'phone', 'telefono', 'teléfono', 'tel', 'whatsapp', 'celular'),
    company: pickIntake(body, 'company', 'empresa', 'negocio'),
    value: pickIntake(body, 'value', 'valor', 'budget', 'presupuesto'),
    note: pickIntake(body, 'note', 'nota', 'message', 'mensaje', 'comentario'),
    source: pickIntake(body, 'source', 'fuente', 'utm_source') || 'webhook',
    sourceLabel: 'Webhook',
    tags: Array.isArray(body.tags || body.etiquetas) ? (body.tags || body.etiquetas) : String(body.tags || body.etiquetas || '').split(',').filter(Boolean),
  };
  const pauta = camposDePauta(body);
  if (Object.keys(pauta).length) mapped.custom_fields = { ...(mapped.custom_fields || {}), ...pauta };
  return mapped;
}

function jsonOut(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method === 'GET') return jsonOut({ ok: true, hint: 'Envía un POST con los datos del lead (name, email, phone, company, value, source)' });
  if (req.method !== 'POST') return jsonOut({ error: 'Método no permitido' }, 405);

  const url = new URL(req.url);
  const token = String(url.searchParams.get('token') || url.pathname.split('/').pop() || '');
  if (!/^[a-f0-9]{24,64}$/i.test(token)) return jsonOut({ error: 'Webhook no encontrado' }, 404);

  // Body: JSON o form-urlencoded (en edge se parsea a mano)
  let reqBody = {};
  try {
    const ct = req.headers.get('content-type') || '';
    if (ct.includes('json')) reqBody = await req.json();
    else {
      const text = await req.text();
      reqBody = Object.fromEntries(new URLSearchParams(text));
    }
  } catch {}

  try {
    // 1. Automatización activa dueña de este token
    const autos = await sb(`/automations?trigger->>type=eq.webhook&trigger->>token=eq.${encodeURIComponent(token)}&active=eq.true&select=*&limit=1`);
    const auto = autos?.[0];
    if (!auto) {
      // Fallback: webhook de entrada genérico del usuario (Fuentes de leads).
      // Crea/mergea el lead y dispara lead_created/tag_added — sin automatización fija.
      const conns = await sb(`/platform_connections?platform=eq.lead_webhook&access_token=eq.${encodeURIComponent(token)}&select=user_id,client_id&limit=1`);
      const conn = conns?.[0];
      if (!conn) return jsonOut({ error: 'Webhook no encontrado o automatización inactiva' }, 404);
      const mapped = datosDelPayload(reqBody);
      if (!mapped.name && !mapped.email && !mapped.phone) return jsonOut({ error: 'Faltan datos de contacto (name, email o phone)' }, 400);
      // El ámbito de la conexión manda; si no tiene, se resuelve el de la
      // cuenta. Antes entraba `null` fijo y el lead caía en el tablero vacío
      // que nadie mira.
      const cliente = conn.client_id || await ambitoDeTrabajo(conn.user_id);
      const { lead, created } = await intakeLead(conn.user_id, cliente, mapped);
      return jsonOut({ ok: true, lead_id: lead.id, created });
    }

    // 2. Crear o mergear el lead por el mismo camino que el resto de entradas.
    //    Antes esta vía hacía su propio INSERT y se saltaba todo lo que va
    //    detrás de un lead nuevo: el reparto entre comerciales, el correo
    //    «Nuevo lead para ti», la tarea de primer contacto y las
    //    automatizaciones lead_created. intakeLead ya deduplica por correo y
    //    teléfono, así que un reenvío no crea un segundo lead.
    //    El ámbito es el de la automatización, tal cual: ahí vive el flujo, y
    //    el lead tiene que estar en el mismo cliente para que el job lo vea.
    const datos = datosDelPayload(reqBody);
    const name = datos.name || 'Lead sin nombre';
    const email = datos.email;
    const { lead, created } = await intakeLead(auto.user_id, auto.client_id || null, datos);

    // 3. Encolar el flujo (dedupe: si ya hay un job pendiente de esta automatización para este lead, no duplicar)
    const pend = await sb(`/automation_jobs?automation_id=eq.${auto.id}&lead_id=eq.${lead.id}&status=eq.pending&select=id&limit=1`);
    if (!pend?.length) {
      await sb('/automation_jobs', 'POST', {
        automation_id: auto.id, user_id: auto.user_id, lead_id: lead.id,
        step_index: 0, status: 'pending', run_at: new Date().toISOString(),
      }, 'return=minimal');
      await sb('/automation_logs', 'POST', {
        automation_id: auto.id, user_id: auto.user_id, lead_id: lead.id,
        step_index: 0, action: 'trigger', result: 'enqueued', detail: 'Webhook externo · ' + name + (email ? ' · ' + email : ''),
      }, 'return=minimal').catch(() => {});
    }

    return jsonOut({ ok: true, lead_id: lead.id, created });
  } catch (e) {
    console.error('[hook] error:', e.message);
    return jsonOut({ error: 'Error interno' }, 500);
  }
}

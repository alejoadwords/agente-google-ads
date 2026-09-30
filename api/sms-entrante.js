// api/sms-entrante.js — respuestas de SMS que reenvía LabsMobile.
//
// Lo que importa aquí es la BAJA: en Colombia quien recibe un SMS comercial
// puede responder «SALIR» o «CANCELAR» y el remitente tiene que dejar de
// escribirle. Como varias cuentas salen por el mismo código corto, la baja se
// aplica a la cuenta que le escribió por última vez a ese número: es la
// «remitente» a la que respondió. Se le pone la etiqueta `no-sms` a sus leads
// con ese móvil, y ningún motor vuelve a mandarle SMS.
//
// LabsMobile manda POST JSON {msisdn, message, …} sin autenticación, así que
// la URL que se le configura lleva un secreto: ?k=<SMS_ENTRANTE_SECRETO>.
// Solo funciona si se contrata un número de recepción con ellos.

export const config = { runtime: 'edge' };

import { normalizarTelefono, ETIQUETA_BAJA } from './_sms.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const H = { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

export const PIDE_BAJA = /^\W*(salir|cancelar|baja|stop|no\s+m[aá]s)\b/i;

async function sb(ruta, init = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, { headers: { ...H, ...(init.headers || {}) }, ...init });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

export default async function handler(req) {
  const url = new URL(req.url);
  const secreto = process.env.SMS_ENTRANTE_SECRETO;
  if (!secreto || url.searchParams.get('k') !== secreto) return new Response('no autorizado', { status: 401 });
  if (req.method !== 'POST') return new Response('método no permitido', { status: 405 });

  const d = await req.json().catch(() => ({}));
  const telefono = normalizarTelefono(d.msisdn);
  const texto = String(d.message || '');
  if (!telefono || !PIDE_BAJA.test(texto)) return Response.json({ ok: true, accion: 'ignorado' });

  try {
    const [ultimo] = await sb(`/sms_envios?telefono=eq.${telefono}&select=user_id&order=created_at.desc&limit=1`);
    if (!ultimo) return Response.json({ ok: true, accion: 'sin_remitente' });

    // Los leads de esa cuenta con ese móvil, escrito como sea: se filtra por
    // los últimos dígitos en la base y se compara el número entero aquí.
    const diez = telefono.slice(-10);
    const leads = await sb(`/leads?user_id=eq.${encodeURIComponent(ultimo.user_id)}&phone=like.*${diez.slice(-4)}&select=id,phone,tags&limit=1000`);
    const suyos = (leads || []).filter(l => String(l.phone || '').replace(/\D/g, '').endsWith(diez));
    const ahora = new Date().toISOString();
    for (const l of suyos) {
      if ((l.tags || []).includes(ETIQUETA_BAJA)) continue;
      await sb(`/leads?id=eq.${l.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ tags: [...(l.tags || []), ETIQUETA_BAJA], updated_at: ahora }) });
      await sb('/lead_activities', { method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ lead_id: l.id, user_id: ultimo.user_id, type: 'nota',
          content: `Pidió no recibir más SMS (respondió «${texto.slice(0, 40)}»).`, metadata: { sms_baja: true } }) });
    }
    return Response.json({ ok: true, accion: 'baja', leads: suyos.length });
  } catch (e) {
    // 500 para que LabsMobile reintente: perder una baja es incumplir la ley.
    console.error('[sms-entrante]', e.message);
    return new Response('reintentar', { status: 500 });
  }
}

// api/audiencias.js — audiencias del CRM hacia Google y Meta (punto 4)
//
//   GET  /api/audiencias?client_id=      audiencias, cuentas conectadas y si Google ya dio el permiso
//   POST {accion:'crear', nombre, conexion_id, segmento, filtro, consentimiento:true}
//   POST {accion:'sincronizar', id}      la sube ya (además del cron diario)
//   POST {accion:'activar', id, activa}
//   POST {accion:'borrar', id}           deja de sincronizarse; en la red queda la lista
//
// Crear y sincronizar leen todos los leads y hablan con la red: puede pasar de
// los 25 s de una función edge, así que contestan en streaming (espacios y el
// JSON al final), como el Analista y los reportes.
//
// Quién: dueño, administrador o Mercadeo; no desde una sesión de soporte (sube
// datos de los contactos del cliente a una red publicitaria: lo decide él).

export const config = { runtime: 'edge' };

import { verificarSesion, cuerpoSinSesion } from './_sesion.js';
import { quienPregunta, exigeModulo, soloSusLeads, alcanceDeCliente } from './_perfiles.js';
import { soporteDe } from './_soporte-sesion.js';
import { planDeCuenta } from './_cupo-agente.js';
import { conexionesDe } from './pauta.js';
import { sincronizar, SEGMENTOS, ESCOPO_GOOGLE } from './_audiencias.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = (extra = {}) => ({ 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, ...extra });
async function sb(ruta, init) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, { headers: sbH(), ...(init || {}) });
  if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + (await r.text()).slice(0, 160));
  return r.status === 204 ? null : r.json().catch(() => null);
}
const jsonResp = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
const TOPE = 30;

function enStreaming(trabajo) {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({
    async start(ctrl) {
      const latido = setInterval(() => { try { ctrl.enqueue(enc.encode(' ')); } catch {} }, 4000);
      let fin;
      try { fin = await trabajo(); } catch (e) { console.error('[audiencias]', e); fin = { error: 'No pudimos terminar. Vuelve a intentarlo en un momento.' }; }
      clearInterval(latido);
      ctrl.enqueue(enc.encode(JSON.stringify(fin)));
      ctrl.close();
    },
  }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

/** Limpia lo que manda el navegador. Pura. */
export function validarAudiencia(b) {
  const nombre = String(b?.nombre || '').trim().slice(0, 120);
  if (!nombre) return { error: 'Ponle un nombre a la audiencia.' };
  if (!SEGMENTOS[b.segmento]) return { error: 'Elige qué leads entran.' };
  if (!b.conexion_id) return { error: 'Elige la cuenta publicitaria.' };
  if (b.consentimiento !== true) return { error: 'Confirma que tienes la autorización de estos contactos para usar sus datos en publicidad.' };
  const f = b.filtro || {};
  const etiquetas = (Array.isArray(f.etiquetas) ? f.etiquetas : String(f.etiquetas || '').split(','))
    .map(t => String(t).trim()).filter(Boolean).slice(0, 20);
  if (b.segmento === 'etiquetas' && !etiquetas.length) return { error: 'Escribe al menos una etiqueta.' };
  const dias = [0, 30, 90, 180, 365].includes(Number(f.dias)) ? Number(f.dias) : 0;
  return { audiencia: { nombre, segmento: b.segmento, conexion_id: String(b.conexion_id), filtro: { ...(etiquetas.length ? { etiquetas } : {}), ...(dias ? { dias } : {}) } } };
}

// ¿Esta conexión de Google ya dio el permiso de audiencias? Se pregunta a
// Google: el permiso vive en el token, no en nuestra base.
async function permisoGoogle(c) {
  try {
    const { abrirConexion } = await import('./_cifrado.js');
    const f = c.refresh_token ? c : await abrirConexion(c);
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: f.refresh_token, grant_type: 'refresh_token' }),
    });
    const d = await r.json().catch(() => ({}));
    return d.access_token ? String(d.scope || '').includes(ESCOPO_GOOGLE.split('/').pop()) : null;
  } catch { return null; }
}

export default async function handler(req) {
  if (req.method !== 'GET' && req.method !== 'POST') return jsonResp({ error: 'Método no permitido' }, 405);
  const sesion = await verificarSesion(req);
  if (!sesion.id) return jsonResp(await cuerpoSinSesion(sesion, 'audiencias'), 401);
  try {
    const quien = await quienPregunta(sesion.id);
    const corte = exigeModulo(quien, 'marketing');
    if (corte) return corte;
    const uid = encodeURIComponent(quien.userId);
    const puede = !soloSusLeads(quien.perfil);

    if (req.method === 'GET') {
      const cliente = alcanceDeCliente(quien, new URL(req.url).searchParams.get('client_id'));
      const fc = cliente ? `&client_id=eq.${encodeURIComponent(cliente)}` : '';
      const [audiencias, conexiones] = await Promise.all([
        sb(`/audiencias_crm?user_id=eq.${uid}${fc}&select=*&order=created_at.asc`),
        conexionesDe(quien.userId, cliente, !quien.cliente),
      ]);
      const cuentas = await Promise.all(conexiones.filter(c => c.account_id).map(async c => ({
        id: c.id, red: c.platform === 'google_ads' ? 'google' : 'meta', nombre: c.account_name || c.account_id,
        permiso: c.platform === 'google_ads' ? await permisoGoogle(c) : true,
      })));
      const p = await planDeCuenta(quien.userId);
      return jsonResp({ audiencias, cuentas, segmentos: SEGMENTOS, puede_editar: puede, plan_ok: !p.ok || (p.plan && p.plan !== 'free') });
    }

    if (!puede) return jsonResp({ error: 'Tu perfil no puede manejar audiencias. Pídeselo al administrador.' }, 403);
    if (await soporteDe(sesion)) return jsonResp({ error: 'Subir contactos a una red publicitaria lo decide el propio cliente.' }, 403);
    const body = await req.json().catch(() => ({}));

    if (body.accion === 'crear') {
      const p = await planDeCuenta(quien.userId);
      if (p.ok && (!p.plan || p.plan === 'free')) return jsonResp({ error: 'Las audiencias del CRM son de los planes Pro y Agencia.', mejorar: true }, 403);
      const v = validarAudiencia(body);
      if (v.error) return jsonResp({ error: v.error }, 400);
      const cliente = alcanceDeCliente(quien, body.client_id);
      const [con] = await sb(`/platform_connections?id=eq.${encodeURIComponent(v.audiencia.conexion_id)}&user_id=eq.${uid}&platform=in.(google_ads,meta_ads)&select=id,platform,client_id,account_id`) || [];
      if (!con || !con.account_id) return jsonResp({ error: 'Esa cuenta publicitaria no es de tu cuenta.' }, 404);
      if (quien.cliente && con.client_id && con.client_id !== quien.cliente) return jsonResp({ error: 'Esa cuenta publicitaria es de otro cliente.' }, 403);
      const ya = await sb(`/audiencias_crm?user_id=eq.${uid}&select=id`) || [];
      if (ya.length >= TOPE) return jsonResp({ error: 'Máximo ' + TOPE + ' audiencias por cuenta.' }, 409);
      const quienDecide = quien.actorId || quien.userId;
      const [aud] = await sb('/audiencias_crm', {
        method: 'POST', headers: sbH({ Prefer: 'return=representation' }),
        body: JSON.stringify({ ...v.audiencia, user_id: quien.userId, client_id: cliente, red: con.platform === 'google_ads' ? 'google' : 'meta',
          consentimiento_por: quienDecide, creado_por: quienDecide, activa: true }),
      }) || [];
      return enStreaming(async () => ({ audiencia_id: aud.id, ...(await sincronizar(aud)) }));
    }

    const [aud] = await sb(`/audiencias_crm?id=eq.${encodeURIComponent(body.id)}&user_id=eq.${uid}&select=*`) || [];
    if (!aud || (quien.cliente && aud.client_id !== quien.cliente)) return jsonResp({ error: 'Esa audiencia no existe.' }, 404);

    if (body.accion === 'sincronizar') return enStreaming(() => sincronizar(aud));
    if (body.accion === 'activar') {
      await sb(`/audiencias_crm?id=eq.${aud.id}`, { method: 'PATCH', headers: sbH({ Prefer: 'return=minimal' }), body: JSON.stringify({ activa: !!body.activa, updated_at: new Date().toISOString() }) });
      return jsonResp({ ok: true });
    }
    if (body.accion === 'borrar') {
      await sb(`/audiencias_crm?id=eq.${aud.id}`, { method: 'DELETE' });
      return jsonResp({ ok: true });
    }
    return jsonResp({ error: 'Acción desconocida' }, 400);
  } catch (e) {
    console.error('[audiencias]', e);
    return jsonResp({ error: 'No pudimos atender esto ahora mismo. Vuelve a intentarlo en un momento.' }, 500);
  }
}

// api/reportes.js — reportes programados para clientes (punto 8)
//
//   GET  /api/reportes?client_id=             programas, últimos envíos y sugerencias
//   POST {accion:'guardar', programa:{…}}     crear o editar (con id)
//   POST {accion:'activar', id, activo}
//   POST {accion:'borrar', id}                los reportes ya enviados siguen abiertos
//   POST {accion:'vista_previa', id | programa}  lo arma sin enviarlo (también con el
//                                             formulario sin guardar) y devuelve el reporte
//   POST {accion:'editar_resumen', reporte_id, resumen}   antes de enviarlo
//   POST {accion:'enviar_reporte', reporte_id, programa_id}  manda ESA versión, la revisada
//
// Nada sale al cliente sin haberse visto: desde la app solo se envía un
// reporte ya armado y revisado. El envío programado, si `revisar_antes`, también
// espera aprobación (ver api/cron-reportes.js).
//
// Armar un reporte lee Google, Meta, el CRM y llama a la IA: puede pasar de
// los 25 s que una función edge tiene para empezar a responder. Vista previa y
// envío contestan en streaming (espacios y el JSON al final), como el Analista.
//
// Quién: dueño, administrador o Mercadeo. Una sesión de soporte puede ver y
// pedir una vista previa, pero no programar ni mandar correos a nombre del cliente.

export const config = { runtime: 'edge' };

import { verificarSesion, cuerpoSinSesion } from './_sesion.js';
import { quienPregunta, exigeModulo, soloSusLeads, alcanceDeCliente } from './_perfiles.js';
import { soporteDe } from './_soporte-sesion.js';
import { planDeCuenta } from './_cupo-agente.js';
import { armarReporte, enviarReporte, proximoEnvio, hoyColombia, MAX_DESTINATARIOS, TOPE_PROGRAMAS } from './_reportes.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = (extra = {}) => ({ 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, ...extra });
async function sb(ruta, init) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, { headers: sbH(), ...(init || {}) });
  if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + (await r.text()).slice(0, 160));
  return r.status === 204 ? null : r.json().catch(() => null);
}
const jsonResp = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });

const CORREO = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i;

/** Limpia lo que manda el navegador. Devuelve {programa} o {error}. Pura. */
export function validarPrograma(p) {
  const nombre = String(p?.nombre || '').trim().slice(0, 80);
  if (!nombre) return { error: 'Ponle un nombre al reporte (normalmente, el del cliente).' };
  if (!['semanal', 'quincenal', 'mensual'].includes(p.frecuencia)) return { error: 'Elige cada cuánto se envía.' };
  const lista = (Array.isArray(p.destinatarios) ? p.destinatarios : String(p.destinatarios || '').split(/[\s,;]+/))
    .map(x => String(x).trim().toLowerCase()).filter(Boolean);
  const malos = lista.filter(x => !CORREO.test(x));
  if (malos.length) return { error: 'Este correo no es válido: ' + malos[0] };
  const destinatarios = [...new Set(lista)];
  if (!destinatarios.length) return { error: 'Escribe al menos un correo para enviarlo.' };
  if (destinatarios.length > MAX_DESTINATARIOS) return { error: 'Máximo ' + MAX_DESTINATARIOS + ' destinatarios por reporte.' };
  const logo = String(p.logo_url || '').trim();
  if (logo && (!/^https:\/\/[^\s"'<>]+$/i.test(logo) || logo.length > 500)) return { error: 'El logo tiene que ser un enlace https a una imagen.' };
  const color = String(p.color || '').trim();
  if (color && !/^#[0-9a-f]{6}$/i.test(color)) return { error: 'El color va como #RRGGBB, por ejemplo #1E2BCC.' };
  return { programa: {
    nombre, frecuencia: p.frecuencia, destinatarios,
    firma: String(p.firma || '').replace(/[<>"\\]/g, '').trim().slice(0, 60) || null,
    logo_url: logo || null, color: color || null, incluir_ia: p.incluir_ia !== false,
    revisar_antes: p.revisar_antes !== false,
  } };
}

/** Responde en streaming: espacios mientras se trabaja, el JSON al final. */
function enStreaming(trabajo) {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({
    async start(ctrl) {
      const latido = setInterval(() => { try { ctrl.enqueue(enc.encode(' ')); } catch {} }, 4000);
      let fin;
      try { fin = await trabajo(); }
      catch (e) { console.error('[reportes]', e); fin = { error: 'No pudimos armar el reporte. Vuelve a intentarlo en un momento.' }; }
      clearInterval(latido);
      ctrl.enqueue(enc.encode(JSON.stringify(fin)));
      ctrl.close();
    },
  }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

async function sugerencias(userId, cliente) {
  // Para no empezar en blanco: la empresa del onboarding firma, y el perfil del
  // cliente da su nombre y su correo.
  const [onb, prof] = await Promise.all([
    sb(`/onboarding_cuenta?user_id=eq.${encodeURIComponent(userId)}&select=empresa&limit=1`).catch(() => []),
    sb(`/user_profiles?user_id=eq.${encodeURIComponent(userId)}&agent_key=eq.__agency_clients__&select=profile_data&limit=1`).catch(() => []),
  ]);
  const lista = prof?.[0]?.profile_data?.clients || [];
  const c = (cliente && lista.find(x => x.id === cliente)) || (!cliente && lista.length === 1 ? lista[0] : null);
  const correo = String(c?.email || '').trim();
  return { firma: onb?.[0]?.empresa || null, nombre: c?.name || null, destinatario: CORREO.test(correo) ? correo : null };
}

export default async function handler(req) {
  if (req.method !== 'GET' && req.method !== 'POST') return jsonResp({ error: 'Método no permitido' }, 405);
  const sesion = await verificarSesion(req);
  if (!sesion.id) return jsonResp(await cuerpoSinSesion(sesion, 'reportes'), 401);
  try {
    const quien = await quienPregunta(sesion.id);
    const corte = exigeModulo(quien, 'marketing');
    if (corte) return corte;
    const uid = encodeURIComponent(quien.userId);
    const puede = !soloSusLeads(quien.perfil);
    const p = await planDeCuenta(quien.userId);
    // Si no se pudo preguntar el plan, se deja pasar: frenar por un fallo de Clerk es peor.
    const tope = p.ok ? (TOPE_PROGRAMAS[p.plan || 'free'] ?? 0) : null;

    if (req.method === 'GET') {
      const cliente = alcanceDeCliente(quien, new URL(req.url).searchParams.get('client_id'));
      const fc = cliente ? `&client_id=eq.${encodeURIComponent(cliente)}` : '';
      const [programas, enviados, sug] = await Promise.all([
        sb(`/reportes_programados?user_id=eq.${uid}${fc}&select=*&order=created_at.asc`),
        sb(`/reportes_enviados?user_id=eq.${uid}${fc}&estado=neq.vista&select=id,token,programa_id,desde,hasta,estado,error,enviado_a,vistas,resumen,created_at&order=created_at.desc&limit=30`),
        sugerencias(quien.userId, cliente),
      ]);
      return jsonResp({ programas, enviados, sugerencias: sug, puede_editar: puede, plan: p.ok ? (p.plan || 'free') : null, tope });
    }

    const body = await req.json().catch(() => ({}));
    if (!puede) return jsonResp({ error: 'Tu perfil no puede manejar reportes. Pídeselo al administrador.' }, 403);
    const ajeno = (f) => !f || (quien.cliente && f.client_id !== quien.cliente);
    const programaDe = async (id) => {
      const [f] = await sb(`/reportes_programados?id=eq.${encodeURIComponent(id)}&user_id=eq.${uid}&select=*`) || [];
      return ajeno(f) ? null : f;
    };

    if (body.accion === 'vista_previa') {
      // Con id: el programa guardado. Sin id: lo que está en el formulario,
      // para verlo ANTES de programar nada.
      let prog;
      if (body.id) prog = await programaDe(body.id);
      else {
        const v = validarPrograma(body.programa);
        if (v.error) return jsonResp({ error: v.error }, 400);
        prog = { ...v.programa, id: null, user_id: quien.userId, client_id: alcanceDeCliente(quien, body.programa?.client_id) };
      }
      if (!prog) return jsonResp({ error: 'Ese reporte no existe.' }, 404);
      return enStreaming(async () => {
        const fila = await armarReporte(prog, { vista: true });
        // `url` va también para las pestañas que siguen con la versión anterior
        // de la app: sin él abrían «/undefined», que carga el inicio.
        return { ok: true, url: 'https://app.acuarius.app/r/' + fila.token + '?previa=1',
          reporte: { id: fila.id, token: fila.token, resumen: fila.resumen, etiqueta: fila.datos.etiqueta } };
      });
    }

    // Un reporte armado que todavía no salió: el de una vista previa o el que
    // dejó el cron esperando revisión. Solo esos se editan o se envían.
    const reporteDe = async (id) => {
      const [f] = await sb(`/reportes_enviados?id=eq.${encodeURIComponent(id)}&user_id=eq.${uid}&select=*`) || [];
      if (!f || ajeno(f)) return { error: 'Ese reporte no existe.', status: 404 };
      if (!['vista', 'por_revisar'].includes(f.estado)) return { error: 'Ese reporte ya se envió.', status: 409 };
      // Una vista previa vieja tiene números viejos: mejor generarla de nuevo.
      if (Date.now() - Date.parse(f.created_at) > 3 * 86400000) return { error: 'Esta versión tiene más de 3 días. Genera una nueva para enviar números al día.', status: 409 };
      return { fila: f };
    };

    if (body.accion === 'editar_resumen') {
      const r = await reporteDe(body.reporte_id);
      if (r.error) return jsonResp({ error: r.error }, r.status);
      const resumen = String(body.resumen || '').trim().slice(0, 1500) || null;
      await sb(`/reportes_enviados?id=eq.${r.fila.id}`, { method: 'PATCH', headers: sbH({ Prefer: 'return=minimal' }), body: JSON.stringify({ resumen }) });
      return jsonResp({ ok: true, resumen });
    }

    // Lo demás programa o manda correos a nombre del cliente: no desde soporte.
    if (await soporteDe(sesion)) return jsonResp({ error: 'Esto lo decide el propio cliente.' }, 403);

    if (body.accion === 'guardar') {
      const v = validarPrograma(body.programa);
      if (v.error) return jsonResp({ error: v.error }, 400);
      const hoy = hoyColombia();
      if (body.programa?.id) {
        const viejo = await programaDe(body.programa.id);
        if (!viejo) return jsonResp({ error: 'Ese reporte no existe.' }, 404);
        const cambio = { ...v.programa, updated_at: new Date().toISOString() };
        if (viejo.frecuencia !== v.programa.frecuencia) cambio.proximo_envio = proximoEnvio(v.programa.frecuencia, hoy);
        const [f] = await sb(`/reportes_programados?id=eq.${viejo.id}`, { method: 'PATCH', headers: sbH({ Prefer: 'return=representation' }), body: JSON.stringify(cambio) }) || [];
        return jsonResp({ ok: true, programa: f });
      }
      if (tope === 0) return jsonResp({ error: 'Los reportes programados son de los planes Pro y Agencia.', mejorar: true }, 403);
      if (tope !== null) {
        const ya = await sb(`/reportes_programados?user_id=eq.${uid}&select=id`) || [];
        if (ya.length >= tope) return jsonResp({ error: 'Tu plan permite ' + tope + (tope === 1 ? ' reporte programado.' : ' reportes programados.') + (p.plan === 'pro' ? ' El plan Agencia permite hasta 50.' : ''), mejorar: p.plan === 'pro' }, 403);
      }
      const [f] = await sb('/reportes_programados', {
        method: 'POST', headers: sbH({ Prefer: 'return=representation' }),
        body: JSON.stringify({ ...v.programa, user_id: quien.userId, client_id: alcanceDeCliente(quien, body.programa?.client_id),
          creado_por: quien.actorId || quien.userId, activo: true, proximo_envio: proximoEnvio(v.programa.frecuencia, hoy) }),
      }) || [];
      return jsonResp({ ok: true, programa: f });
    }

    if (body.accion === 'enviar_reporte') {
      const r = await reporteDe(body.reporte_id);
      if (r.error) return jsonResp({ error: r.error }, r.status);
      const prog = await programaDe(body.programa_id);
      if (!prog) return jsonResp({ error: 'Guarda el reporte programado antes de enviarlo.' }, 404);
      // Se toma la fila: si dos clics llegan a la vez, solo uno la encuentra en su estado.
      const tomadas = await sb(`/reportes_enviados?id=eq.${r.fila.id}&estado=in.(vista,por_revisar)`, {
        method: 'PATCH', headers: sbH({ Prefer: 'return=representation' }), body: JSON.stringify({ estado: 'fallido', error: 'Enviando…', programa_id: prog.id }),
      }) || [];
      if (!tomadas.length) return jsonResp({ error: 'Ese reporte ya se está enviando.' }, 409);
      const e = await enviarReporte({ ...r.fila, programa_id: prog.id }, prog, prog.destinatarios);
      if (e.error) return jsonResp({ error: e.error }, 502);
      await sb(`/reportes_programados?id=eq.${prog.id}`, { method: 'PATCH', headers: sbH({ Prefer: 'return=minimal' }), body: JSON.stringify({ ultimo_envio: new Date().toISOString() }) });
      return jsonResp({ ok: true, enviado_a: prog.destinatarios });
    }

    const prog = await programaDe(body.id);
    if (!prog) return jsonResp({ error: 'Ese reporte no existe.' }, 404);

    if (body.accion === 'activar') {
      const cambio = { activo: !!body.activo, updated_at: new Date().toISOString() };
      // Al encenderlo, el siguiente envío se cuenta desde hoy, no desde cuando se apagó.
      if (body.activo) cambio.proximo_envio = proximoEnvio(prog.frecuencia, hoyColombia());
      await sb(`/reportes_programados?id=eq.${prog.id}`, { method: 'PATCH', headers: sbH({ Prefer: 'return=minimal' }), body: JSON.stringify(cambio) });
      return jsonResp({ ok: true });
    }
    if (body.accion === 'borrar') {
      await sb(`/reportes_programados?id=eq.${prog.id}`, { method: 'DELETE' });
      return jsonResp({ ok: true });
    }
    return jsonResp({ error: 'Acción desconocida' }, 400);
  } catch (e) {
    console.error('[reportes]', e);
    return jsonResp({ error: 'No pudimos atender esto ahora mismo. Vuelve a intentarlo en un momento.' }, 500);
  }
}

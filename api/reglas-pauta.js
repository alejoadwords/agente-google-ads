// api/reglas-pauta.js — reglas automáticas de la pauta (punto 5)
//
//   GET  /api/reglas-pauta?client_id=                 reglas y acciones recientes
//   POST {accion:'guardar', regla:{…}}                crear o editar (con id)
//   POST {accion:'activar', id, activa}               encender o apagar
//   POST {accion:'borrar', id}                        quitar (el historial queda)
//   POST {accion:'previa', regla:{…}}                 qué tocaría hoy, sin guardar
//   POST {accion:'aprobar' | 'descartar', id}         decidir una propuesta
//
// Quién: el dueño, un administrador o Mercadeo (los que llegan a Marketing y
// no están limitados a sus leads), igual que el botón «Pausar». Una sesión de
// soporte puede MIRAR, pero no aprobar ni crear reglas: es la plata del cliente.

export const config = { runtime: 'edge' };

import { verificarSesion, cuerpoSinSesion } from './_sesion.js';
import { quienPregunta, exigeModulo, soloSusLeads, alcanceDeCliente } from './_perfiles.js';
import { soporteDe } from './_soporte-sesion.js';
import { vistaPrevia, reclamar, ejecutarAccion } from './_reglas-pauta.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = (extra = {}) => ({ 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, ...extra });
async function sb(ruta, init) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, { headers: sbH(), ...(init || {}) });
  if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + (await r.text()).slice(0, 160));
  return r.status === 204 ? null : r.json().catch(() => null);
}
const jsonResp = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });

const TOPE_REGLAS = 20;
const METRICAS = ['cpl_real', 'costo_venta', 'gasto_sin_leads'];
const ACCIONES = ['avisar', 'pausar', 'bajar_presupuesto'];

// «50.000» en Colombia son cincuenta mil, no cincuenta: leído como número de
// JavaScript, una regla de CPL de 50.000 pausaría todo. Punto de miles y coma
// decimal si el texto tiene esa forma; si no, el número tal cual (12.50 USD).
export function leerMonto(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/[^\d.,]/g, '');
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.'));
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return Number(s.replace(/,/g, ''));
  return Number(s.replace(',', '.'));
}

/** Limpia lo que manda el navegador. Devuelve {regla} o {error}. */
export function validarRegla(r) {
  const nombre = String(r?.nombre || '').trim().slice(0, 80);
  if (!nombre) return { error: 'Ponle un nombre a la regla.' };
  const red = ['todas', 'google', 'meta'].includes(r.red) ? r.red : null;
  if (!red) return { error: 'Elige en qué red aplica.' };
  if (!METRICAS.includes(r.metrica)) return { error: 'Elige qué medir.' };
  const dias = Number(r.dias);
  if (![3, 7, 14].includes(dias)) return { error: 'La ventana es de 3, 7 o 14 días.' };
  const umbral = leerMonto(r.umbral);
  if (!(umbral > 0)) return { error: 'El límite tiene que ser un monto mayor que cero.' };
  if (!ACCIONES.includes(r.accion)) return { error: 'Elige qué hacer cuando se cumpla.' };
  const porcentaje = r.accion === 'bajar_presupuesto' ? Math.round(Number(r.porcentaje)) : null;
  if (r.accion === 'bajar_presupuesto' && !(porcentaje >= 1 && porcentaje <= 50)) return { error: 'El recorte va del 1 % al 50 %.' };
  const campana_id = String(r.campana_id || '').replace(/\D/g, '') || null;
  return { regla: {
    nombre, red, metrica: r.metrica, dias, umbral, accion: r.accion, porcentaje,
    // «Avisar» no toca nada: no hay qué aprobar.
    modo: r.accion !== 'avisar' && r.modo === 'auto' ? 'auto' : 'aprobar',
    campana_id, campana: campana_id ? String(r.campana || '').slice(0, 200) || null : null,
  } };
}

export default async function handler(req) {
  if (req.method !== 'GET' && req.method !== 'POST') return jsonResp({ error: 'Método no permitido' }, 405);
  const sesion = await verificarSesion(req);
  if (!sesion.id) return jsonResp(await cuerpoSinSesion(sesion, 'reglas-pauta'), 401);

  try {
    const quien = await quienPregunta(sesion.id);
    const corte = exigeModulo(quien, 'marketing');
    if (corte) return corte;
    const uid = encodeURIComponent(quien.userId);
    const puede = !soloSusLeads(quien.perfil);

    if (req.method === 'GET') {
      const url = new URL(req.url);
      const cliente = alcanceDeCliente(quien, url.searchParams.get('client_id'));
      // Con un cliente elegido: sus reglas y las de toda la cuenta (que también
      // le aplican). Las acciones, solo las de sus campañas.
      const fr = cliente ? `&or=(client_id.eq.${encodeURIComponent(cliente)},client_id.is.null)` : '';
      const fa = cliente ? `&client_id=eq.${encodeURIComponent(cliente)}` : '';
      const desde = new Date(Date.now() - 60 * 86400000).toISOString();
      const [reglas, acciones] = await Promise.all([
        sb(`/reglas_pauta?user_id=eq.${uid}${fr}&select=*&order=created_at.asc`),
        sb(`/acciones_pauta?user_id=eq.${uid}${fa}&created_at=gte.${encodeURIComponent(desde)}&select=*&order=created_at.desc&limit=200`),
      ]);
      return jsonResp({ reglas: reglas || [], acciones: acciones || [], puede_editar: puede, tope: TOPE_REGLAS });
    }

    if (!puede) return jsonResp({ error: 'Tu perfil no puede cambiar campañas. Pídeselo al administrador.' }, 403);
    const body = await req.json().catch(() => ({}));
    const quienDecide = quien.actorId || quien.userId;

    if (body.accion === 'previa') {
      const v = validarRegla(body.regla);
      if (v.error) return jsonResp({ error: v.error }, 400);
      const regla = { ...v.regla, client_id: alcanceDeCliente(quien, body.regla?.client_id) };
      return jsonResp({ tocaria: await vistaPrevia(quien.userId, regla) });
    }

    // De aquí en adelante se cambia algo: no desde una sesión de soporte.
    if (await soporteDe(sesion)) return jsonResp({ error: 'Esto lo decide el propio cliente.' }, 403);

    // Una regla o acción que no es de su cliente no existe para un miembro acotado.
    const ajena = (fila) => !fila || (quien.cliente && fila.client_id !== quien.cliente);

    if (body.accion === 'guardar') {
      const v = validarRegla(body.regla);
      if (v.error) return jsonResp({ error: v.error }, 400);
      const id = body.regla?.id;
      if (id) {
        const [vieja] = await sb(`/reglas_pauta?id=eq.${encodeURIComponent(id)}&user_id=eq.${uid}&select=id,client_id`) || [];
        if (ajena(vieja)) return jsonResp({ error: 'Esa regla no existe.' }, 404);
        const [f] = await sb(`/reglas_pauta?id=eq.${encodeURIComponent(id)}&user_id=eq.${uid}`, {
          method: 'PATCH', headers: sbH({ Prefer: 'return=representation' }),
          body: JSON.stringify({ ...v.regla, updated_at: new Date().toISOString() }),
        }) || [];
        return jsonResp({ ok: true, regla: f });
      }
      const ya = await sb(`/reglas_pauta?user_id=eq.${uid}&select=id`) || [];
      if (ya.length >= TOPE_REGLAS) return jsonResp({ error: 'Llegaste al máximo de ' + TOPE_REGLAS + ' reglas. Borra una que ya no uses.' }, 409);
      const [f] = await sb('/reglas_pauta', {
        method: 'POST', headers: sbH({ Prefer: 'return=representation' }),
        body: JSON.stringify({ ...v.regla, user_id: quien.userId, client_id: alcanceDeCliente(quien, body.regla?.client_id), creada_por: quienDecide, activa: true }),
      }) || [];
      return jsonResp({ ok: true, regla: f });
    }

    if (body.accion === 'activar' || body.accion === 'borrar') {
      const [r] = await sb(`/reglas_pauta?id=eq.${encodeURIComponent(body.id)}&user_id=eq.${uid}&select=id,client_id`) || [];
      if (ajena(r)) return jsonResp({ error: 'Esa regla no existe.' }, 404);
      if (body.accion === 'borrar') {
        // El historial de lo que hizo se queda (regla_id pasa a null, el nombre sigue).
        await sb(`/reglas_pauta?id=eq.${encodeURIComponent(body.id)}&user_id=eq.${uid}`, { method: 'DELETE' });
        return jsonResp({ ok: true });
      }
      await sb(`/reglas_pauta?id=eq.${encodeURIComponent(body.id)}&user_id=eq.${uid}`, {
        method: 'PATCH', headers: sbH({ Prefer: 'return=minimal' }),
        body: JSON.stringify({ activa: !!body.activa, updated_at: new Date().toISOString() }),
      });
      return jsonResp({ ok: true });
    }

    if (body.accion === 'aprobar' || body.accion === 'descartar') {
      const [a] = await sb(`/acciones_pauta?id=eq.${encodeURIComponent(body.id)}&user_id=eq.${uid}&select=*`) || [];
      if (ajena(a)) return jsonResp({ error: 'Esa propuesta no existe.' }, 404);
      if (body.accion === 'descartar') {
        const f = await reclamar(quien.userId, a.id, 'descartada', quienDecide);
        return f ? jsonResp({ ok: true, accion: f }) : jsonResp({ error: 'Esa propuesta ya se decidió.', accion: a }, 409);
      }
      const f = await reclamar(quien.userId, a.id);
      if (!f) return jsonResp({ error: 'Esa propuesta ya se decidió.', accion: a }, 409);
      const hecha = await ejecutarAccion(f, quienDecide);
      return hecha.estado === 'ejecutada'
        ? jsonResp({ ok: true, accion: hecha })
        : jsonResp({ error: hecha.resultado || 'No se pudo hacer el cambio.', accion: hecha }, 502);
    }

    return jsonResp({ error: 'Acción desconocida' }, 400);
  } catch (e) {
    console.error('[reglas-pauta]', e);
    return jsonResp({ error: 'No pudimos atender esto ahora mismo. Vuelve a intentarlo en un momento.' }, 500);
  }
}


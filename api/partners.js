// api/partners.js — el programa de Partners, para el Partner y para el equipo
//
// Del Partner (cualquier cuenta con sesión):
//   GET  ?vista=yo              ¿soy Partner?, en qué estado, mi enlace, ¿soy admin?
//   POST {accion:'postular', ...datos}           pide entrar (o vuelve a pedirlo si lo rechazaron)
//   POST {accion:'perfil', ...datos}             actualiza sus datos (incluidos los de pago)
//   GET  ?vista=panel           cifras: cuentas, MRR traído, comisiones
//   GET  ?vista=cuentas         las cuentas que trajo, con su estado
//   GET  ?vista=comisiones      sus comisiones y liquidaciones
//   POST {accion:'subir_factura', tipo}          URL firmada para subir la factura (bucket privado)
//   POST {accion:'liquidar', ids, factura_ruta, factura_nombre, nota}
//
// Del equipo (ADMIN_EMAILS, comprobado contra Clerk en cada petición):
//   GET  ?vista=admin           partners por estado y liquidaciones pendientes
//   GET  ?vista=pendientes      lo que la campana del equipo debe avisar
//   POST {accion:'decidir', user_id, estado, comision_pct, notas_admin}
//   POST {accion:'pagar', id, referencia}       marca una liquidación como pagada
//   POST {accion:'rechazar_liquidacion', id, nota}   devuelve sus comisiones a disponibles
//   GET  ?vista=factura&id=     URL firmada (10 min) para ver la factura
//
// Reglas del programa y cálculo: api/_partners.js.

export const config = { runtime: 'edge' };

import { verificarSesion, cuerpoSinSesion } from './_sesion.js';
import { soporteDe } from './_soporte-sesion.js';
import { emailHtml, esc } from './_email-layout.js';
import { enviarResend } from './_correo.js';
import {
  sb, sbH, PCT_POR_DEFECTO, ESTADOS_PARTNER, mrrDe, armarLiquidacion, estadoCuenta, slugDesde,
  tasaUSD, clerkUsuario, clerkUsuarios, correoPrincipal, nombreDe, admins,
} from './_partners.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const BUCKET = 'partners-facturas';
const APP = 'https://app.acuarius.app';
const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const usd = n => Number(n || 0).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' USD';
const lista = v => (Array.isArray(v) ? v : String(v || '').split(','))
  .map(x => String(x).trim()).filter(Boolean).slice(0, 30).map(x => x.slice(0, 60));
const texto = (v, max) => { const t = String(v ?? '').trim(); return t ? t.slice(0, max) : null; };

/** Limpia lo que manda el navegador al postularse o editar el perfil. Pura. */
export function validarDatos(b) {
  const nombre_comercial = texto(b.nombre_comercial, 120);
  const correo = texto(b.correo, 160)?.toLowerCase() || null;
  if (!nombre_comercial) return { error: 'Escribe el nombre comercial de tu empresa o marca.' };
  if (!correo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return { error: 'Escribe un correo válido.' };
  let sitio_web = texto(b.sitio_web, 200);
  if (sitio_web && !/^https?:\/\//i.test(sitio_web)) sitio_web = 'https://' + sitio_web;
  return {
    datos: {
      nombre_comercial, correo, sitio_web,
      whatsapp: texto(b.whatsapp, 40),
      paises: lista(b.paises), sectores: lista(b.sectores), servicios: lista(b.servicios),
      propuesta: texto(b.propuesta, 3000),
      datos_pago: texto(b.datos_pago, 1000),
    },
  };
}

async function correo(donde, para, asunto, html) {
  return enviarResend(donde, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Acuarius <crm@app.acuarius.app>', to: para, reply_to: 'ceo@acuarius.app', subject: asunto, html }),
  }).catch(() => null);
}
const avisarEquipo = (asunto, titulo, cuerpo) =>
  correo('partners', admins(), asunto, emailHtml({ titulo, intro: '', cuerpo, cta: { texto: 'Abrir Partners', url: APP + '/?ir=partners' } }));

/** Un aviso para la campana del Partner. No corta lo que se estaba haciendo. */
async function avisarPartner(userId, tipo, titulo, texto) {
  try {
    await sb('/partner_avisos', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({ partner_user_id: userId, tipo, titulo, texto }) });
  } catch (e) { console.error('[partners] no se pudo crear el aviso', tipo, e.message); }
}

/** Un slug libre para su enlace, a partir del nombre comercial. */
async function slugLibre(base) {
  const b = slugDesde(base) || 'partner';
  for (let i = 0; i < 20; i++) {
    const s = i ? (b.slice(0, 26) + '-' + (i + 1)) : b;
    const ya = await sb(`/enlaces_registro?slug=eq.${encodeURIComponent(s)}&select=slug`) || [];
    if (!ya.length && !['acuarius', 'admin', 'soporte', 'api', 'app', 'login', 'registro', 'www', 'ayuda', 'help', 'clientify'].includes(s)) return s;
  }
  return b.slice(0, 22) + '-' + Date.now().toString(36);
}

export default async function handler(req) {
  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  const sesion = await verificarSesion(req);
  if (!sesion.id) return json(await cuerpoSinSesion(sesion, 'partners'), 401);
  const yo = sesion.id;
  const url = new URL(req.url);

  try {
    const [partner] = await sb(`/partners?user_id=eq.${encodeURIComponent(yo)}&select=*`) || [];
    const esAdmin = async () => {
      if (await soporteDe(sesion)) return false;
      const u = await clerkUsuario(yo);
      return admins().includes(correoPrincipal(u));
    };

    // ── Lecturas ────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const vista = url.searchParams.get('vista') || 'yo';

      if (vista === 'yo') {
        return json({ partner: partner || null, es_admin: await esAdmin(), enlace: partner?.slug ? `${APP}/registro/${partner.slug}` : null });
      }

      // Lo que la campana del equipo tiene que avisar: postulaciones por revisar
      // y liquidaciones por pagar. A quien no es del equipo se le contesta que
      // no lo es, y la app deja de preguntar en esa sesión.
      if (vista === 'pendientes') {
        // Los avisos propios del Partner (aprobación, pagos) van a su campana.
        const avisos = partner ? (await sb(`/partner_avisos?partner_user_id=eq.${encodeURIComponent(yo)}&leido_at=is.null&select=id,tipo,titulo,texto,creado_at&order=creado_at.desc&limit=20`) || []) : [];
        if (!(await esAdmin())) return json({ es_admin: false, es_partner: !!partner, pendientes: [], avisos });
        const posts = await sb('/partners?estado=eq.postulado&select=user_id,nombre_comercial,creado_at&order=creado_at.desc') || [];
        const liqs = await sb('/partner_liquidaciones?estado=eq.solicitada&select=id,partner_user_id,total_usd,solicitada_at&order=solicitada_at.desc') || [];
        const noms = liqs.length ? Object.fromEntries((await sb(`/partners?user_id=in.(${[...new Set(liqs.map(l => encodeURIComponent(l.partner_user_id)))].join(',')})&select=user_id,nombre_comercial`) || []).map(p => [p.user_id, p.nombre_comercial])) : {};
        return json({ es_admin: true, es_partner: !!partner, avisos, pendientes: [
          ...posts.map(p => ({ id: 'post-' + p.user_id, tipo: 'postulacion', titulo: p.nombre_comercial, texto: 'Se postuló como Partner', fecha: p.creado_at })),
          ...liqs.map(l => ({ id: 'liq-' + l.id, tipo: 'liquidacion', titulo: noms[l.partner_user_id] || 'Partner', texto: 'Pide su liquidación de ' + usd(l.total_usd), fecha: l.solicitada_at })),
        ] });
      }

      if (vista === 'admin') {
        if (!(await esAdmin())) return json({ error: 'Solo el equipo de Acuarius' }, 403);
        const todos = await sb('/partners?select=*&order=creado_at.desc') || [];
        const refs = await sb('/partner_referidos?select=partner_user_id') || [];
        const coms = await sb('/partner_comisiones?select=partner_user_id,estado,comision_usd') || [];
        const liq = await sb('/partner_liquidaciones?select=*&order=solicitada_at.desc&limit=200') || [];
        const sum = (pid, est) => coms.filter(c => c.partner_user_id === pid && c.estado === est).reduce((s, c) => s + Number(c.comision_usd), 0);
        const nombres = Object.fromEntries(todos.map(p => [p.user_id, p.nombre_comercial]));
        return json({
          partners: todos.map(p => ({
            ...p, cuentas: refs.filter(r => r.partner_user_id === p.user_id).length,
            disponible_usd: Math.round(sum(p.user_id, 'disponible') * 100) / 100,
            pagado_usd: Math.round(sum(p.user_id, 'pagada') * 100) / 100,
          })),
          liquidaciones: liq.map(l => ({ ...l, partner: nombres[l.partner_user_id] || l.partner_user_id })),
        });
      }

      if (vista === 'factura') {
        const [l] = await sb(`/partner_liquidaciones?id=eq.${encodeURIComponent(url.searchParams.get('id'))}&select=partner_user_id,factura_ruta`) || [];
        if (!l) return json({ error: 'No existe' }, 404);
        if (l.partner_user_id !== yo && !(await esAdmin())) return json({ error: 'No autorizado' }, 403);
        const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${l.factura_ruta}`, { method: 'POST', headers: sbH(), body: JSON.stringify({ expiresIn: 600 }) });
        const d = await r.json().catch(() => ({}));
        if (!d.signedURL) return json({ error: 'No se pudo abrir la factura' }, 502);
        return json({ url: `${SUPABASE_URL}/storage/v1${d.signedURL}` });
      }

      if (!partner || partner.estado !== 'aprobado') return json({ error: 'Tu cuenta no es Partner aprobado' }, 403);

      if (vista === 'panel' || vista === 'cuentas') {
        const refs = await sb(`/partner_referidos?partner_user_id=eq.${encodeURIComponent(yo)}&select=*&order=creado_at.desc`) || [];
        const usuarios = refs.length ? await clerkUsuarios(refs.map(r => r.referido_user_id)) : {};
        const ids = refs.map(r => r.referido_user_id);
        const cobros = ids.length ? (await sb(`/cobros?user_id=in.(${ids.map(encodeURIComponent).join(',')})&tipo=eq.cobro&select=user_id,plan,tipo,monto,moneda,periodo,cobrado_at&order=cobrado_at.desc`) || []) : [];
        const coms = await sb(`/partner_comisiones?partner_user_id=eq.${encodeURIComponent(yo)}&select=referido_user_id,comision_usd,estado,cobrado_at`) || [];
        const tasas = {};
        for (const m of new Set(cobros.map(c => c.moneda))) { try { tasas[m] = await tasaUSD(m); } catch { tasas[m] = 0; } }
        const cuentas = refs.map(r => {
          const u = usuarios[r.referido_user_id];
          const meta = u?.public_metadata || {};
          const estado = u ? estadoCuenta(meta) : 'eliminada';
          const ultimo = cobros.find(c => c.user_id === r.referido_user_id);
          const susComs = coms.filter(c => c.referido_user_id === r.referido_user_id && c.estado !== 'anulada');
          return {
            id: r.referido_user_id, nombre: nombreDe(u) || r.nombre || '', correo: correoPrincipal(u) || r.correo || '',
            plan: meta.plan || 'free', estado, registrada_at: r.creado_at,
            ultimo_cobro_at: ultimo?.cobrado_at || null,
            mrr_usd: estado === 'activa' ? mrrDe(cobros.filter(c => c.user_id === r.referido_user_id), tasas) : 0,
            comision_total_usd: Math.round(susComs.reduce((s, c) => s + Number(c.comision_usd), 0) * 100) / 100,
          };
        });
        if (vista === 'cuentas') return json({ cuentas });
        const hace12 = Date.now() - 365 * 86400e3;
        const suma = f => Math.round(coms.filter(f).reduce((s, c) => s + Number(c.comision_usd), 0) * 100) / 100;
        return json({
          enlace: partner.slug ? `${APP}/registro/${partner.slug}` : null,
          comision_pct: Number(partner.comision_pct),
          cuentas: {
            total: cuentas.length,
            activas: cuentas.filter(c => c.estado === 'activa').length,
            prueba: cuentas.filter(c => c.estado === 'prueba').length,
            desactivadas: cuentas.filter(c => c.estado === 'desactivada' || c.estado === 'eliminada').length,
          },
          mrr_usd: Math.round(cuentas.reduce((s, c) => s + c.mrr_usd, 0) * 100) / 100,
          comisiones: {
            pagadas_12m: suma(c => c.estado === 'pagada' && Date.parse(c.cobrado_at) >= hace12),
            disponibles: suma(c => c.estado === 'disponible'),
            en_liquidacion: suma(c => c.estado === 'en_liquidacion'),
          },
        });
      }

      if (vista === 'comisiones') {
        const coms = await sb(`/partner_comisiones?partner_user_id=eq.${encodeURIComponent(yo)}&estado=neq.anulada&select=*&order=cobrado_at.desc&limit=500`) || [];
        const refs = await sb(`/partner_referidos?partner_user_id=eq.${encodeURIComponent(yo)}&select=referido_user_id,nombre,correo`) || [];
        const nom = Object.fromEntries(refs.map(r => [r.referido_user_id, r.nombre || r.correo || 'Cuenta']));
        const liq = await sb(`/partner_liquidaciones?partner_user_id=eq.${encodeURIComponent(yo)}&select=id,total_usd,n_comisiones,estado,factura_nombre,solicitada_at,resuelta_at,referencia_pago,nota_admin&order=solicitada_at.desc`) || [];
        return json({ comisiones: coms.map(c => ({ ...c, cuenta: nom[c.referido_user_id] || 'Cuenta' })), liquidaciones: liq });
      }
      return json({ error: 'Vista desconocida' }, 400);
    }

    // ── Escrituras ──────────────────────────────────────────────────────────
    // Desde una sesión de soporte no se postula ni se liquida en nombre de nadie.
    if (await soporteDe(sesion)) return json({ error: 'Esto lo hace el propio Partner desde su cuenta.' }, 403);
    const body = await req.json().catch(() => ({}));

    if (body.accion === 'aviso_leido') {
      await sb(`/partner_avisos?id=eq.${encodeURIComponent(body.id)}&partner_user_id=eq.${encodeURIComponent(yo)}&leido_at=is.null`, {
        method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ leido_at: new Date().toISOString() }),
      });
      return json({ ok: true });
    }

    if (body.accion === 'postular' || body.accion === 'perfil') {
      const v = validarDatos(body);
      if (v.error) return json({ error: v.error }, 400);
      if (body.accion === 'perfil') {
        if (!partner) return json({ error: 'Primero postúlate.' }, 400);
        await sb(`/partners?user_id=eq.${encodeURIComponent(yo)}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ ...v.datos, updated_at: new Date().toISOString() }) });
        return json({ ok: true });
      }
      if (partner && partner.estado !== 'rechazado') return json({ error: 'Ya te postulaste: estado «' + partner.estado + '».' }, 409);
      await sb('/partners?on_conflict=user_id', {
        method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
        body: JSON.stringify({ user_id: yo, ...v.datos, estado: 'postulado', comision_pct: PCT_POR_DEFECTO, creado_at: new Date().toISOString(), decidido_at: null, updated_at: new Date().toISOString() }),
      });
      await avisarEquipo('Nueva postulación de Partner: ' + v.datos.nombre_comercial, 'Alguien quiere ser Partner',
        `<p><b>${esc(v.datos.nombre_comercial)}</b> · ${esc(v.datos.correo)}${v.datos.whatsapp ? ' · ' + esc(v.datos.whatsapp) : ''}</p>` +
        (v.datos.sitio_web ? `<p>${esc(v.datos.sitio_web)}</p>` : '') +
        (v.datos.propuesta ? `<p style="white-space:pre-wrap">${esc(v.datos.propuesta)}</p>` : ''));
      return json({ ok: true, estado: 'postulado' });
    }

    if (body.accion === 'subir_factura') {
      if (!partner || partner.estado !== 'aprobado') return json({ error: 'Solo un Partner aprobado' }, 403);
      const ext = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' }[body.tipo];
      if (!ext) return json({ error: 'La factura tiene que ser PDF, JPG o PNG.' }, 400);
      const ruta = `${yo}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
      const r = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${ruta}`, { method: 'POST', headers: sbH(), body: '{}' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.url) return json({ error: 'No se pudo preparar la subida de la factura.' }, 502);
      return json({ subir_a: `${SUPABASE_URL}/storage/v1${d.url}`, ruta });
    }

    if (body.accion === 'liquidar') {
      if (!partner || partner.estado !== 'aprobado') return json({ error: 'Solo un Partner aprobado' }, 403);
      const ruta = String(body.factura_ruta || '');
      if (!ruta.startsWith(yo + '/')) return json({ error: 'Sube tu factura antes de solicitar la liquidación.' }, 400);
      if (!partner.datos_pago) return json({ error: 'Completa tus datos de pago en «Mi perfil» antes de solicitar la liquidación.' }, 400);
      const disponibles = await sb(`/partner_comisiones?partner_user_id=eq.${encodeURIComponent(yo)}&estado=eq.disponible&select=id,comision_usd`) || [];
      const { dentro, total, ajenas } = armarLiquidacion(disponibles, body.ids);
      if (ajenas.length) return json({ error: 'Alguna comisión elegida ya no está disponible. Recarga la página.' }, 409);
      if (!(total > 0)) return json({ error: 'Elige al menos una comisión: el total tiene que ser mayor que cero.' }, 400);
      const [liq] = await sb('/partner_liquidaciones', {
        method: 'POST', prefer: 'return=representation',
        body: JSON.stringify({ partner_user_id: yo, total_usd: total, n_comisiones: dentro.length, factura_ruta: ruta, factura_nombre: texto(body.factura_nombre, 200), nota_partner: texto(body.nota, 1000) }),
      }) || [];
      // Solo se mueven las que siguen disponibles: si dos pestañas liquidan a la
      // vez, la segunda no se lleva las mismas comisiones.
      const movidas = await sb(`/partner_comisiones?id=in.(${dentro.map(c => c.id).join(',')})&estado=eq.disponible`, {
        method: 'PATCH', prefer: 'return=representation', body: JSON.stringify({ estado: 'en_liquidacion', liquidacion_id: liq.id }),
      }) || [];
      if (movidas.length !== dentro.length) {
        await sb(`/partner_comisiones?liquidacion_id=eq.${liq.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ estado: 'disponible', liquidacion_id: null }) });
        await sb(`/partner_liquidaciones?id=eq.${liq.id}`, { method: 'DELETE' });
        return json({ error: 'Otra solicitud tomó alguna de estas comisiones. Recarga la página.' }, 409);
      }
      await avisarEquipo(`Liquidación de Partner: ${partner.nombre_comercial} · ${usd(total)}`, 'Un Partner pide su liquidación',
        `<p><b>${esc(partner.nombre_comercial)}</b> solicita <b>${usd(total)}</b> por ${dentro.length} comisiones.</p><p>Datos de pago:</p><p style="white-space:pre-wrap">${esc(partner.datos_pago)}</p>`);
      return json({ ok: true, liquidacion: liq });
    }

    // ── Del equipo ──────────────────────────────────────────────────────────
    if (!(await esAdmin())) return json({ error: 'Solo el equipo de Acuarius' }, 403);

    if (body.accion === 'decidir') {
      if (!ESTADOS_PARTNER.includes(body.estado)) return json({ error: 'Estado inválido' }, 400);
      const [p] = await sb(`/partners?user_id=eq.${encodeURIComponent(body.user_id)}&select=*`) || [];
      if (!p) return json({ error: 'No existe ese Partner' }, 404);
      const cambios = { estado: body.estado, decidido_at: new Date().toISOString(), decidido_por: yo, updated_at: new Date().toISOString() };
      if (body.comision_pct != null) {
        const pct = Number(body.comision_pct);
        if (!(pct > 0 && pct <= 50)) return json({ error: 'La comisión tiene que estar entre 1 y 50 %.' }, 400);
        cambios.comision_pct = pct;
      }
      if (body.notas_admin !== undefined) cambios.notas_admin = texto(body.notas_admin, 2000);
      // Al aprobar recibe su enlace de registro (si no tenía uno).
      if (body.estado === 'aprobado' && !p.slug) {
        const [propio] = await sb(`/enlaces_registro?user_id=eq.${encodeURIComponent(p.user_id)}&select=slug`) || [];
        const slug = propio?.slug || await slugLibre(p.nombre_comercial);
        if (!propio) {
          await sb('/enlaces_registro', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({
            user_id: p.user_id, slug, titulo: 'Empieza con Acuarius de la mano de ' + p.nombre_comercial,
            bienvenida: p.nombre_comercial + ' te acompaña en tu prueba de 14 días.', registros: 0,
          }) });
        }
        cambios.slug = slug;
      }
      await sb(`/partners?user_id=eq.${encodeURIComponent(p.user_id)}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify(cambios) });
      if (body.estado === 'aprobado' && p.estado !== 'aprobado') {
        const enlace = `${APP}/registro/${cambios.slug || p.slug}`;
        await avisarPartner(p.user_id, 'aprobado', '¡Ya eres Partner de Acuarius!', 'Tu enlace para registrar clientes ya está listo en tu panel.');
        await correo('partners', p.correo, '¡Ya eres Partner de Acuarius!', emailHtml({
          titulo: 'Te damos la bienvenida al programa de Partners',
          intro: `Ganas el ${Number(cambios.comision_pct || p.comision_pct)} % de lo que pagan por su licencia —el plan más sus usuarios y contactos adicionales— las cuentas que traigas, mientras sigan pagando.`,
          cuerpo: `<p>Tu enlace para registrar clientes:</p><p><b>${esc(enlace)}</b></p><p>Las cuentas que se registren por ahí quedan a tu nombre. Desde tu panel ves cuántas tienes, cuánto has ganado y solicitas tu liquidación cada mes.</p>`,
          cta: { texto: 'Abrir mi panel de Partner', url: APP + '/?ir=partners' },
          pie: 'Equipo de Soporte — Acuarius',
        }));
      }
      return json({ ok: true });
    }

    if (body.accion === 'pagar' || body.accion === 'rechazar_liquidacion') {
      const [l] = await sb(`/partner_liquidaciones?id=eq.${encodeURIComponent(body.id)}&estado=eq.solicitada&select=*`) || [];
      if (!l) return json({ error: 'Esa liquidación no está pendiente' }, 404);
      const pagar = body.accion === 'pagar';
      await sb(`/partner_liquidaciones?id=eq.${l.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({
        estado: pagar ? 'pagada' : 'rechazada', resuelta_at: new Date().toISOString(), resuelta_por: yo,
        referencia_pago: pagar ? texto(body.referencia, 200) : null, nota_admin: texto(body.nota, 1000),
      }) });
      await sb(`/partner_comisiones?liquidacion_id=eq.${l.id}`, { method: 'PATCH', prefer: 'return=minimal',
        body: JSON.stringify(pagar ? { estado: 'pagada' } : { estado: 'disponible', liquidacion_id: null }) });
      await avisarPartner(l.partner_user_id, pagar ? 'pagada' : 'devuelta',
        pagar ? 'Pagamos tu liquidación de ' + usd(l.total_usd) : 'Tu solicitud de liquidación necesita un ajuste',
        pagar ? (body.referencia ? 'Referencia: ' + texto(body.referencia, 200) : 'Revisa tu cuenta de pago.') : (texto(body.nota, 300) || 'Tus comisiones volvieron a quedar disponibles.'));
      const [p] = await sb(`/partners?user_id=eq.${encodeURIComponent(l.partner_user_id)}&select=correo,nombre_comercial`) || [];
      if (p?.correo) {
        await correo('partners', p.correo, pagar ? `Pagamos tu liquidación de ${usd(l.total_usd)}` : 'Tu solicitud de liquidación necesita un ajuste', emailHtml({
          titulo: pagar ? 'Liquidación pagada' : 'Revisa tu solicitud de liquidación',
          intro: pagar ? `Te pagamos ${usd(l.total_usd)} por ${l.n_comisiones} comisiones.` : 'Tus comisiones volvieron a quedar disponibles para que la envíes de nuevo.',
          cuerpo: (body.referencia && pagar ? `<p>Referencia del pago: <b>${esc(body.referencia)}</b></p>` : '') + (body.nota ? `<p style="white-space:pre-wrap">${esc(body.nota)}</p>` : ''),
          cta: { texto: 'Ver mis comisiones', url: APP + '/?ir=partners' },
          pie: 'Equipo de Soporte — Acuarius',
        }));
      }
      return json({ ok: true });
    }

    return json({ error: 'Acción desconocida' }, 400);
  } catch (e) {
    console.error('[partners]', e);
    return json({ error: 'No pudimos atender esto ahora mismo. Vuelve a intentarlo en un momento.' }, 500);
  }
}

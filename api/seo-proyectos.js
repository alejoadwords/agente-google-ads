// api/seo-proyectos.js — Proyecto SEO completo (con sesión).
//
//   GET  ?client_id=           lista de proyectos del ámbito + cupo + IAs activas
//   GET  ?id=                  un proyecto entero (_seo-datos.js) + sus enlaces
//   POST { accion, … }         crear/editar/archivar, clústeres, keywords,
//                              preguntas GEO, cronograma, medir y enlaces
//
// Todo es de la cuenta del DUEÑO y del cliente de agencia, como la parrilla
// de Studio Social: el blob viejo era por persona y cada miembro del equipo
// veía un proyecto distinto. Módulo «marketing».
export const config = { runtime: 'edge' };

import { verificarSesion, cuerpoSinSesion } from './_sesion.js';
import { quienPregunta, exigeModulo, alcanceDeCliente, clienteAjeno } from './_perfiles.js';
import { registrarError } from './_registro-errores.js';
import { estadoSeo } from './_cupo-seo.js';
import { cargarProyecto, todas } from './_seo-datos.js';
import { medirPosiciones, medirGeo, motoresActivos, planDe } from './_seo-medir.js';
import { dominio, accionesIniciales, hoyCO, MAX_KEYWORDS, MAX_PREGUNTAS, MAX_COMPETIDORES, CATEGORIAS, ESTADOS,
  TIPOS_CONTENIDO, transicionContenido, editableContenido } from './_seo.js';
import { avisarClienteRevision } from './_seo-avisos.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = (extra = {}) => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', ...extra });
async function sb(ruta, init = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, { ...init, headers: sbH(init.prefer ? { Prefer: init.prefer } : {}) });
  const t = await r.text();
  if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + t.slice(0, 200));
  return t ? JSON.parse(t) : null;
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const txt = (v, n) => String(v ?? '').trim().slice(0, n);
const ahora = () => new Date().toISOString();

function token() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

export default async function handler(req) {
  try {
    return await manejar(req);
  } catch (e) {
    await registrarError({ origen: 'servidor', donde: 'seo-proyectos', error: e }).catch(() => {});
    return json({ error: 'Hubo un error de nuestro lado y ya nos llegó el aviso. Inténtalo de nuevo en unos minutos.' }, 500);
  }
}

async function manejar(req) {
  const sesion = await verificarSesion(req);
  if (!sesion.id) return json(await cuerpoSinSesion(sesion, 'seo-proyectos'), 401);
  let quien;
  try { quien = await quienPregunta(sesion.id); } catch { return json({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503); }
  const corte = exigeModulo(quien, 'marketing');
  if (corte) return corte;
  const cuenta = quien.userId;

  // Un proyecto de la cuenta y de un cliente al que quien pregunta llega.
  async function proyectoPropio(id) {
    if (!UUID.test(String(id || ''))) return null;
    const [p] = await sb(`/seo_proyectos?id=eq.${id}&user_id=eq.${encodeURIComponent(cuenta)}&archivado_at=is.null&select=*&limit=1`) || [];
    if (!p || clienteAjeno(quien, p.client_id || null)) return null;
    return p;
  }
  // Una fila hija (clúster, keyword…) cuyo proyecto es propio.
  async function hijoPropio(tabla, id) {
    if (!UUID.test(String(id || ''))) return null;
    const [f] = await sb(`/${tabla}?id=eq.${id}&select=*&limit=1`) || [];
    if (!f) return null;
    return (await proyectoPropio(f.proyecto_id)) ? f : null;
  }

  const url = new URL(req.url);
  if (req.method === 'GET') {
    const versionesDe = url.searchParams.get('versiones');
    if (versionesDe) {
      const c = await hijoPropio('seo_contenidos', versionesDe);
      if (!c) return json({ error: 'Esa pieza no existe.' }, 404);
      const versiones = await sb(`/seo_contenido_versiones?contenido_id=eq.${c.id}&select=version,titulo,cuerpo,enlace_doc,creado_at&order=version.desc`) || [];
      return json({ versiones });
    }
    const id = url.searchParams.get('id');
    if (id) {
      const p = await proyectoPropio(id);
      if (!p) return json({ error: 'Ese proyecto no existe o no es de tu cuenta.' }, 404);
      const datos = await cargarProyecto(p.id);
      const enlaces = await sb(`/seo_enlaces?proyecto_id=eq.${p.id}&revocado_at=is.null&select=id,token,vistas,ultima_vista,creado_at,creado_por_nombre&order=creado_at.desc`) || [];
      return json({ ...datos, enlaces, motores: motoresActivos() });
    }
    const pedido = url.searchParams.get('client_id') || null;
    if (clienteAjeno(quien, pedido)) return json({ error: 'No tienes acceso a ese cliente.' }, 403);
    const cli = alcanceDeCliente(quien, pedido) ?? '';
    const proyectos = await sb(`/seo_proyectos?user_id=eq.${encodeURIComponent(cuenta)}&client_id=eq.${encodeURIComponent(cli)}&archivado_at=is.null` +
      `&select=id,nombre,dominio,marca,pais,inicio,creado_at&order=creado_at.asc`) || [];
    const plan = await planDe(cuenta);
    const [posiciones, geo] = plan === null ? [{ error: true }, { error: true }] : await Promise.all([estadoSeo(cuenta, 'posiciones', plan), estadoSeo(cuenta, 'geo', plan)]);
    return json({ proyectos, cupo: { plan, posiciones, geo }, motores: motoresActivos() });
  }

  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  let b;
  try { b = await req.json(); } catch { return json({ error: 'Cuerpo inválido' }, 400); }
  const a = b.accion;

  // ── Proyecto ──────────────────────────────────────────────────────────────
  if (a === 'crear') {
    const pedido = txt(b.client_id, 80) || null;
    if (clienteAjeno(quien, pedido)) return json({ error: 'No tienes acceso a ese cliente.' }, 403);
    const dom = dominio(b.dominio);
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(dom)) return json({ error: 'Escribe el dominio del sitio, por ejemplo: miempresa.com' }, 400);
    const competidores = [...new Set((b.competidores || []).map(dominio).filter(d => d && d !== dom))].slice(0, MAX_COMPETIDORES);
    const inicio = /^\d{4}-\d{2}-\d{2}$/.test(b.inicio || '') ? b.inicio : hoyCO();
    const [p] = await sb('/seo_proyectos', { method: 'POST', prefer: 'return=representation', body: JSON.stringify({
      user_id: cuenta, client_id: alcanceDeCliente(quien, pedido) ?? '', nombre: txt(b.nombre, 120) || dom, dominio: dom,
      marca: txt(b.marca, 120) || null, pais: txt(b.pais, 4) || 'co', competidores, inicio, creado_por: quien.actorId }) });
    if (b.plantilla !== false) {
      await sb('/seo_acciones', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify(accionesIniciales(p.id, inicio, quien.actorId)) });
    }
    return json({ ok: true, proyecto: p });
  }

  // El proyecto de la acción: `id` en editar/archivar, `proyecto_id` en el resto.
  const p = await proyectoPropio(a === 'editar' || a === 'archivar' ? b.id : b.proyecto_id);

  if (a === 'editar' || a === 'archivar') {
    if (!p) return json({ error: 'Ese proyecto no existe o no es de tu cuenta.' }, 404);
    if (a === 'archivar') {
      await sb(`/seo_proyectos?id=eq.${p.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ archivado_at: ahora() }) });
      await sb(`/seo_enlaces?proyecto_id=eq.${p.id}&revocado_at=is.null`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ revocado_at: ahora() }) });
      return json({ ok: true });
    }
    const c = {};
    if (b.nombre !== undefined) c.nombre = txt(b.nombre, 120) || p.nombre;
    if (b.marca !== undefined) c.marca = txt(b.marca, 120) || null;
    if (b.pais !== undefined) c.pais = txt(b.pais, 4) || 'co';
    if (b.inicio !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(b.inicio)) c.inicio = b.inicio;
    if (b.nombre_cliente !== undefined) c.nombre_cliente = txt(b.nombre_cliente, 120) || null;
    if (b.correo_cliente !== undefined) {
      const m = txt(b.correo_cliente, 200).toLowerCase();
      if (m && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m)) return json({ error: 'Ese correo del cliente no es válido.' }, 400);
      c.correo_cliente = m || null;
    }
    if (b.competidores !== undefined) c.competidores = [...new Set((b.competidores || []).map(dominio).filter(d => d && d !== p.dominio))].slice(0, MAX_COMPETIDORES);
    if (b.dominio !== undefined) {
      const dom = dominio(b.dominio);
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(dom)) return json({ error: 'Ese dominio no es válido.' }, 400);
      c.dominio = dom;
    }
    c.actualizado_at = ahora();
    await sb(`/seo_proyectos?id=eq.${p.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify(c) });
    return json({ ok: true });
  }

  // ── Clústeres ─────────────────────────────────────────────────────────────
  if (a === 'cluster_guardar') {
    const nombre = txt(b.nombre, 120);
    if (!nombre) return json({ error: 'Ponle nombre al clúster.' }, 400);
    const campos = { nombre, pagina_pilar: txt(b.pagina_pilar, 500) || null, descripcion: txt(b.descripcion, 1000) || null };
    if (b.id) {
      const c = await hijoPropio('seo_clusters', b.id);
      if (!c) return json({ error: 'Ese clúster no existe.' }, 404);
      await sb(`/seo_clusters?id=eq.${c.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify(campos) });
      return json({ ok: true, id: c.id });
    }
    if (!p) return json({ error: 'Ese proyecto no existe o no es de tu cuenta.' }, 404);
    const [c] = await sb('/seo_clusters', { method: 'POST', prefer: 'return=representation', body: JSON.stringify({ proyecto_id: p.id, ...campos, orden: Date.now() % 1e9 }) });
    return json({ ok: true, id: c.id });
  }
  if (a === 'cluster_borrar') {
    const c = await hijoPropio('seo_clusters', b.id);
    if (!c) return json({ error: 'Ese clúster no existe.' }, 404);
    // Sus keywords y preguntas no se pierden: quedan «sin clúster».
    await sb(`/seo_keywords?cluster_id=eq.${c.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ cluster_id: null }) });
    await sb(`/seo_geo_preguntas?cluster_id=eq.${c.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ cluster_id: null }) });
    await sb(`/seo_clusters?id=eq.${c.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ borrado_at: ahora() }) });
    return json({ ok: true });
  }

  // ── Keywords ──────────────────────────────────────────────────────────────
  if (a === 'keywords_agregar') {
    if (!p) return json({ error: 'Ese proyecto no existe o no es de tu cuenta.' }, 404);
    let cluster = null;
    if (b.cluster_id) { cluster = await hijoPropio('seo_clusters', b.cluster_id); if (!cluster || cluster.proyecto_id !== p.id) return json({ error: 'Ese clúster no existe.' }, 404); }
    const vivas = await todas(`/seo_keywords?proyecto_id=eq.${p.id}&borrado_at=is.null&select=kw`);
    const ya = new Set(vivas.map(k => k.kw.toLowerCase()));
    const nuevas = [...new Set((b.kws || []).map(k => txt(k, 150).replace(/\s+/g, ' ')).filter(Boolean))].filter(k => !ya.has(k.toLowerCase()));
    const cabe = Math.max(0, MAX_KEYWORDS - vivas.length);
    const van = nuevas.slice(0, cabe);
    if (van.length) await sb('/seo_keywords', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify(van.map(kw => ({ proyecto_id: p.id, cluster_id: cluster?.id || null, kw }))) });
    return json({ ok: true, agregadas: van.length, repetidas: (b.kws || []).length - nuevas.length, sinEspacio: nuevas.length - van.length, maximo: MAX_KEYWORDS });
  }
  if (a === 'keyword_mover' || a === 'keyword_borrar') {
    const k = await hijoPropio('seo_keywords', b.id);
    if (!k) return json({ error: 'Esa keyword no existe.' }, 404);
    if (a === 'keyword_borrar') {
      await sb(`/seo_keywords?id=eq.${k.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ borrado_at: ahora() }) });
      return json({ ok: true });
    }
    let destino = null;
    if (b.cluster_id) { const c = await hijoPropio('seo_clusters', b.cluster_id); if (!c || c.proyecto_id !== k.proyecto_id) return json({ error: 'Ese clúster no existe.' }, 404); destino = c.id; }
    await sb(`/seo_keywords?id=eq.${k.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ cluster_id: destino }) });
    return json({ ok: true });
  }

  // ── Preguntas GEO ─────────────────────────────────────────────────────────
  if (a === 'preguntas_agregar') {
    if (!p) return json({ error: 'Ese proyecto no existe o no es de tu cuenta.' }, 404);
    const vivas = await sb(`/seo_geo_preguntas?proyecto_id=eq.${p.id}&borrado_at=is.null&select=pregunta`) || [];
    const ya = new Set(vivas.map(q => q.pregunta.toLowerCase()));
    const nuevas = [...new Set((b.preguntas || []).map(q => txt(q, 400)).filter(Boolean))].filter(q => !ya.has(q.toLowerCase()));
    const van = nuevas.slice(0, Math.max(0, MAX_PREGUNTAS - vivas.length));
    let cluster = null;
    if (b.cluster_id) { cluster = await hijoPropio('seo_clusters', b.cluster_id); if (!cluster || cluster.proyecto_id !== p.id) cluster = null; }
    if (van.length) await sb('/seo_geo_preguntas', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify(van.map(pregunta => ({ proyecto_id: p.id, pregunta, cluster_id: cluster?.id || null, intencion: txt(b.intencion, 40) || null }))) });
    return json({ ok: true, agregadas: van.length, sinEspacio: nuevas.length - van.length, maximo: MAX_PREGUNTAS });
  }
  if (a === 'pregunta_borrar') {
    const q = await hijoPropio('seo_geo_preguntas', b.id);
    if (!q) return json({ error: 'Esa pregunta no existe.' }, 404);
    await sb(`/seo_geo_preguntas?id=eq.${q.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ borrado_at: ahora() }) });
    return json({ ok: true });
  }

  // ── Cronograma ────────────────────────────────────────────────────────────
  if (a === 'accion_guardar') {
    const campos = {};
    if (b.titulo !== undefined) { campos.titulo = txt(b.titulo, 300); if (!campos.titulo) return json({ error: 'Ponle un título a la acción.' }, 400); }
    if (b.detalle !== undefined) campos.detalle = txt(b.detalle, 4000) || null;
    if (b.mes !== undefined) { if (!/^\d{4}-\d{2}$/.test(b.mes)) return json({ error: 'Mes inválido.' }, 400); campos.mes = b.mes; }
    if (b.categoria !== undefined) campos.categoria = CATEGORIAS.includes(b.categoria) ? b.categoria : 'otro';
    if (b.estado !== undefined) {
      if (!ESTADOS.includes(b.estado)) return json({ error: 'Estado inválido.' }, 400);
      campos.estado = b.estado;
      campos.hecha_at = b.estado === 'hecha' ? ahora() : null;
    }
    if (b.visible_cliente !== undefined) campos.visible_cliente = !!b.visible_cliente;
    campos.actualizado_at = ahora();
    if (b.id) {
      const x = await hijoPropio('seo_acciones', b.id);
      if (!x) return json({ error: 'Esa acción no existe.' }, 404);
      await sb(`/seo_acciones?id=eq.${x.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify(campos) });
      return json({ ok: true, id: x.id });
    }
    if (!p) return json({ error: 'Ese proyecto no existe o no es de tu cuenta.' }, 404);
    if (!campos.titulo) return json({ error: 'Ponle un título a la acción.' }, 400);
    const [x] = await sb('/seo_acciones', { method: 'POST', prefer: 'return=representation', body: JSON.stringify({
      proyecto_id: p.id, mes: campos.mes || hoyCO().slice(0, 7), categoria: campos.categoria || 'otro', titulo: campos.titulo,
      detalle: campos.detalle || null, estado: campos.estado || 'pendiente', hecha_at: campos.hecha_at || null,
      visible_cliente: campos.visible_cliente !== false, orden: Date.now() % 1e9, creado_por: quien.actorId }) });
    return json({ ok: true, id: x.id });
  }
  if (a === 'accion_borrar') {
    const x = await hijoPropio('seo_acciones', b.id);
    if (!x) return json({ error: 'Esa acción no existe.' }, 404);
    await sb(`/seo_acciones?id=eq.${x.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ borrado_at: ahora() }) });
    return json({ ok: true });
  }
  if (a === 'plantilla_inicial') {
    if (!p) return json({ error: 'Ese proyecto no existe o no es de tu cuenta.' }, 404);
    const ya = await sb(`/seo_acciones?proyecto_id=eq.${p.id}&plantilla=like.inicial-*&borrado_at=is.null&select=plantilla`) || [];
    const tiene = new Set(ya.map(x => x.plantilla));
    const faltan = accionesIniciales(p.id, p.inicio, quien.actorId).filter(x => !tiene.has(x.plantilla));
    if (faltan.length) await sb('/seo_acciones', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify(faltan) });
    return json({ ok: true, agregadas: faltan.length });
  }

  // ── Medir ahora ───────────────────────────────────────────────────────────
  if (a === 'medir_posiciones') {
    if (!p) return json({ error: 'Ese proyecto no existe o no es de tu cuenta.' }, 404);
    const r = await medirPosiciones(p, { actorId: quien.actorId, presupuestoMs: 18000 });
    if (r.error) return json({ error: r.error }, 503);
    return json({ ok: true, ...r });
  }
  if (a === 'medir_geo') {
    if (!p) return json({ error: 'Ese proyecto no existe o no es de tu cuenta.' }, 404);
    const r = await medirGeo(p, { actorId: quien.actorId, presupuestoMs: 18000 });
    if (r.error) return json({ error: r.error }, 503);
    return json({ ok: true, ...r });
  }

  // ── Calendario de contenido (fase 2) ──────────────────────────────────────
  if (a === 'contenido_guardar') {
    const campos = {};
    if (b.fecha !== undefined) campos.fecha = /^\d{4}-\d{2}-\d{2}$/.test(b.fecha || '') ? b.fecha : null;
    if (b.tipo !== undefined) campos.tipo = TIPOS_CONTENIDO.includes(b.tipo) ? b.tipo : 'otro';
    if (b.keyword !== undefined) campos.keyword = txt(b.keyword, 150) || null;
    const textos = {};
    if (b.titulo !== undefined) { textos.titulo = txt(b.titulo, 300); if (!textos.titulo) return json({ error: 'Ponle un título a la pieza.' }, 400); }
    if (b.cuerpo !== undefined) textos.cuerpo = txt(b.cuerpo, 60000) || null;
    if (b.enlace_doc !== undefined) {
      const u = txt(b.enlace_doc, 1000);
      if (u && !/^https?:\/\//i.test(u)) return json({ error: 'El enlace del documento debe empezar por https://' }, 400);
      textos.enlace_doc = u || null;
    }
    if (b.id) {
      const c = await hijoPropio('seo_contenidos', b.id);
      if (!c) return json({ error: 'Esa pieza no existe.' }, 404);
      if (b.cluster_id !== undefined) {
        if (!b.cluster_id) campos.cluster_id = null;
        else { const cl = await hijoPropio('seo_clusters', b.cluster_id); if (!cl || cl.proyecto_id !== c.proyecto_id) return json({ error: 'Ese clúster no existe.' }, 404); campos.cluster_id = cl.id; }
      }
      // Lo que el cliente revisa o ya aprobó no cambia por debajo.
      const cambiaTexto = Object.entries(textos).some(([k, v]) => (c[k] ?? null) !== (v ?? null));
      if (cambiaTexto && !editableContenido(c.estado)) return json({ error: 'Esta pieza está en revisión o aprobada: vuélvela a borrador para editar el texto.', bloqueada: true }, 409);
      await sb(`/seo_contenidos?id=eq.${c.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ ...campos, ...textos, actualizado_at: ahora() }) });
      return json({ ok: true, id: c.id });
    }
    if (!p) return json({ error: 'Ese proyecto no existe o no es de tu cuenta.' }, 404);
    if (!textos.titulo) return json({ error: 'Ponle un título a la pieza.' }, 400);
    if (b.cluster_id) { const cl = await hijoPropio('seo_clusters', b.cluster_id); campos.cluster_id = cl && cl.proyecto_id === p.id ? cl.id : null; }
    const [c] = await sb('/seo_contenidos', { method: 'POST', prefer: 'return=representation', body: JSON.stringify({
      proyecto_id: p.id, ...campos, ...textos, tipo: campos.tipo || 'articulo', creado_por: quien.actorId }) });
    return json({ ok: true, id: c.id });
  }
  if (['contenido_enviar', 'contenido_publicar', 'contenido_borrador'].includes(a)) {
    const c = await hijoPropio('seo_contenidos', b.id);
    if (!c) return json({ error: 'Esa pieza no existe.' }, 404);
    const accion = { contenido_enviar: 'enviar', contenido_publicar: 'publicar', contenido_borrador: 'borrador' }[a];
    const t = transicionContenido(c.estado, accion, 'agencia');
    if (t.error) return json({ error: t.error }, 409);
    const cambios = { estado: t.estado, actualizado_at: ahora() };
    if (accion === 'enviar') {
      if (!c.cuerpo && !c.enlace_doc) return json({ error: 'Escribe el contenido o pega el enlace del documento antes de mandarlo a revisar.' }, 400);
      cambios.version = (c.version || 0) + 1; cambios.enviado_at = ahora(); cambios.aprobado_at = null; cambios.aprobado_por = null;
      // La versión que se manda queda guardada: lo aprobado es esto, no lo que se edite después.
      await sb('/seo_contenido_versiones?on_conflict=contenido_id,version', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
        body: JSON.stringify({ contenido_id: c.id, version: cambios.version, titulo: c.titulo, cuerpo: c.cuerpo, enlace_doc: c.enlace_doc, creado_por: quien.actorId }) });
    }
    if (accion === 'publicar') {
      const u = txt(b.url_publicada, 1000);
      if (u && !/^https?:\/\//i.test(u)) return json({ error: 'La URL publicada debe empezar por https://' }, 400);
      cambios.url_publicada = u || null; cambios.publicado_at = ahora();
    }
    await sb(`/seo_contenidos?id=eq.${c.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify(cambios) });
    let aviso = null;
    if (accion === 'enviar') {
      const [pr] = await sb(`/seo_proyectos?id=eq.${c.proyecto_id}&select=*&limit=1`) || [];
      const [en] = await sb(`/seo_enlaces?proyecto_id=eq.${c.proyecto_id}&revocado_at=is.null&select=token&order=creado_at.desc&limit=1`) || [];
      aviso = await avisarClienteRevision({ proyecto: pr, contenido: { ...c, ...cambios }, token: en?.token });
    }
    return json({ ok: true, estado: t.estado, aviso });
  }
  if (a === 'contenido_comentar') {
    const c = await hijoPropio('seo_contenidos', b.id);
    if (!c) return json({ error: 'Esa pieza no existe.' }, 404);
    const texto = txt(b.texto, 4000);
    if (!texto) return json({ error: 'Escribe el comentario.' }, 400);
    await sb('/seo_contenido_comentarios', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({
      contenido_id: c.id, version: c.version || null, autor_tipo: 'agencia', autor_nombre: quien.nombre || null, autor_id: quien.actorId, accion: 'comentario', texto }) });
    return json({ ok: true });
  }
  if (a === 'contenido_borrar') {
    const c = await hijoPropio('seo_contenidos', b.id);
    if (!c) return json({ error: 'Esa pieza no existe.' }, 404);
    await sb(`/seo_contenidos?id=eq.${c.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ borrado_at: ahora() }) });
    return json({ ok: true });
  }

  // ── Enlace público ────────────────────────────────────────────────────────
  if (a === 'enlace_crear') {
    if (!p) return json({ error: 'Ese proyecto no existe o no es de tu cuenta.' }, 404);
    const t = token();
    await sb('/seo_enlaces', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({
      token: t, proyecto_id: p.id, user_id: cuenta, creado_por: quien.actorId, creado_por_nombre: quien.nombre || null }) });
    return json({ ok: true, url: 'https://app.acuarius.app/seo/' + t });
  }
  if (a === 'enlace_revocar') {
    const e = await hijoPropio('seo_enlaces', b.id);
    if (!e) return json({ error: 'Ese enlace no existe.' }, 404);
    await sb(`/seo_enlaces?id=eq.${e.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ revocado_at: ahora() }) });
    return json({ ok: true });
  }

  return json({ error: 'Acción desconocida' }, 400);
}

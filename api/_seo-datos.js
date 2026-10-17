// api/_seo-datos.js — cargar un proyecto SEO entero.
//
// Lo usan la app (api/seo-proyectos.js) y el enlace público
// (api/seo-publico.js) con la MISMA consulta: si cada uno armara la suya,
// algún día el cliente vería cifras distintas de las de la agencia. Con
// `publico` se quitan las acciones ocultas al cliente y los datos internos
// (quién creó qué). Solo se importa desde edge.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = (extra = {}) => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, ...extra });

async function una(ruta) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, { headers: sbH() });
  if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + (await r.text()).slice(0, 200));
  return r.json();
}

// PostgREST corta en 1.000 filas: se pide por tramos hasta que no venga más.
export async function todas(ruta, tramo = 1000) {
  const out = [];
  for (let desde = 0; desde < 100000; desde += tramo) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, { headers: sbH({ Range: `${desde}-${desde + tramo - 1}`, 'Range-Unit': 'items' }) });
    if (!r.ok && r.status !== 416) throw new Error('Supabase ' + r.status + ': ' + (await r.text()).slice(0, 200));
    const filas = r.status === 416 ? [] : await r.json();
    out.push(...filas);
    if (filas.length < tramo) break;
  }
  return out;
}

const CAMPOS_PROYECTO = 'id,user_id,client_id,nombre,dominio,marca,pais,idioma,competidores,inicio,correo_cliente,nombre_cliente,creado_at,actualizado_at,' +
  'gsc_propiedad,ga4_propiedad,gsc_estado,ga4_estado,gsc_error,ga4_error,gsc_sincronizado_at,ga4_sincronizado_at';

export async function cargarProyecto(id, { publico = false } = {}) {
  const [p] = await una(`/seo_proyectos?id=eq.${id}&archivado_at=is.null&select=${CAMPOS_PROYECTO}&limit=1`);
  if (!p) return null;
  const hace400 = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
  const hace13m = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 7);
  const [clusters, keywords, posiciones, preguntas, geo, acciones] = await Promise.all([
    una(`/seo_clusters?proyecto_id=eq.${id}&borrado_at=is.null&select=id,nombre,pagina_pilar,descripcion,orden&order=orden.asc,creado_at.asc`),
    todas(`/seo_keywords?proyecto_id=eq.${id}&borrado_at=is.null&select=id,kw,cluster_id,creado_at&order=creado_at.asc`),
    todas(`/seo_posiciones?proyecto_id=eq.${id}&fecha=gte.${hace400}&select=keyword_id,fecha,pos,url&order=fecha.asc,id.asc`),
    una(`/seo_geo_preguntas?proyecto_id=eq.${id}&borrado_at=is.null&select=id,pregunta,intencion,cluster_id&order=creado_at.asc`),
    todas(`/seo_geo_resultados?proyecto_id=eq.${id}&periodo=gte.${hace13m}&select=pregunta_id,periodo,motor,corrida,mencionada,citada,posicion,competidores,citas,fragmento,error&order=periodo.asc,id.asc`),
    una(`/seo_acciones?proyecto_id=eq.${id}&borrado_at=is.null${publico ? '&visible_cliente=eq.true' : ''}` +
      `&select=id,mes,categoria,titulo,detalle,estado,hecha_at,visible_cliente,orden,plantilla&order=mes.asc,orden.asc,creado_at.asc`),
  ]);
  // Los 5 primeros de Google solo de la última medición (la competencia de hoy).
  const ultima = posiciones.length ? posiciones[posiciones.length - 1].fecha : null;
  const top = ultima ? await todas(`/seo_posiciones?proyecto_id=eq.${id}&fecha=eq.${ultima}&select=keyword_id,top`) : [];
  // Calendario de contenido (fase 2). Un borrador es trabajo interno: el
  // cliente ve que está planeado (título, fecha, tipo), no su texto.
  const contenidos = await una(`/seo_contenidos?proyecto_id=eq.${id}&borrado_at=is.null` +
    `&select=id,cluster_id,titulo,tipo,keyword,fecha,estado,cuerpo,enlace_doc,url_publicada,version,enviado_at,aprobado_at,aprobado_por,publicado_at,actualizado_at&order=fecha.asc.nullslast,creado_at.asc`);
  const ids = contenidos.map(c => c.id);
  const comentarios = ids.length ? await todas(`/seo_contenido_comentarios?contenido_id=in.(${ids.join(',')})` +
    `&select=id,contenido_id,version,autor_tipo,autor_nombre,accion,texto,creado_at&order=creado_at.asc`) : [];
  // Tráfico (fase 3): por día todo el historial; búsquedas y páginas, el mes
  // en curso y el anterior (lo que se reporta); las IAs, por mes.
  const mesActual = new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 7);
  const [ya, ma] = mesActual.split('-').map(Number);
  const mesAnterior = ma === 1 ? (ya - 1) + '-12' : ya + '-' + String(ma - 1).padStart(2, '0');
  const meses2 = `mes=in.(${mesAnterior},${mesActual})`;
  const [gscDias, gscConsultas, gscPaginas, ga4Dias, ga4Ia] = await Promise.all([
    p.gsc_propiedad ? todas(`/seo_gsc_dias?proyecto_id=eq.${id}&select=fecha,clics,impresiones,posicion&order=fecha.asc`) : [],
    p.gsc_propiedad ? todas(`/seo_gsc_consultas?proyecto_id=eq.${id}&${meses2}&select=mes,consulta,clics,impresiones,posicion&order=clics.desc,impresiones.desc`) : [],
    p.gsc_propiedad ? todas(`/seo_gsc_paginas?proyecto_id=eq.${id}&${meses2}&select=mes,pagina,clics,impresiones,posicion&order=clics.desc`) : [],
    p.ga4_propiedad ? todas(`/seo_ga4_dias?proyecto_id=eq.${id}&select=fecha,sesiones,usuarios,conversiones,sesiones_organicas,conversiones_organicas,sesiones_ia,conversiones_ia&order=fecha.asc`) : [],
    p.ga4_propiedad ? todas(`/seo_ga4_ia?proyecto_id=eq.${id}&select=mes,fuente,sesiones,conversiones&order=mes.asc`) : [],
  ]);
  const trafico = { gscDias, gscConsultas, gscPaginas, ga4Dias, ga4Ia, mesActual, mesAnterior };
  const proyecto = { ...p };
  if (publico) {
    delete proyecto.user_id; delete proyecto.client_id; delete proyecto.correo_cliente;
    for (const k of ['gsc_propiedad', 'ga4_propiedad', 'gsc_estado', 'ga4_estado', 'gsc_error', 'ga4_error']) delete proyecto[k];
    for (const c of contenidos) if (c.estado === 'borrador') { c.cuerpo = null; c.enlace_doc = null; }
  }
  const visibles = new Set(contenidos.filter(c => !publico || c.estado !== 'borrador').map(c => c.id));
  return { proyecto, clusters, keywords, posiciones, top, preguntas, geo, acciones, ultimaMedicion: ultima,
    contenidos, comentarios: comentarios.filter(x => visibles.has(x.contenido_id)), trafico };
}

// api/_meta-reporte.js — lo de Meta que lleva el reporte para clientes
//
// El reporte que las agencias hacen a mano (ver el de Certain de agosto 2026)
// separa la pauta de Meta en dos capas —reconocimiento de marca y captación—
// y enseña campañas, públicos y los anuncios que más conversaciones abrieron,
// con su imagen. Aquí se lee todo eso de la API de Meta, en una pasada por
// nivel (campaña, conjunto, anuncio).
//
// Sin App Review solo funciona con cuentas que tienen rol en la app; para el
// resto Meta devuelve error y el reporte sale sin sus pestañas (no se cae).
//
// SOLO desde funciones edge (regla 2 de CLAUDE.md).

const GRAPH = 'https://graph.facebook.com/v21.0';
// Objetivos que no buscan un contacto: son la capa de marca.
const OBJ_MARCA = new Set(['OUTCOME_AWARENESS', 'REACH', 'BRAND_AWARENESS', 'VIDEO_VIEWS', 'OUTCOME_ENGAGEMENT', 'POST_ENGAGEMENT', 'PAGE_LIKES', 'OUTCOME_TRAFFIC', 'LINK_CLICKS']);
const n = (v) => Number(v || 0);

/** Suma las acciones que importan de una fila de insights. Pura. */
export function accionesDe(actions) {
  const a = {};
  for (const x of actions || []) a[x.action_type] = n(x.value);
  return {
    conversaciones: a['onsite_conversion.messaging_conversation_started_7d'] || 0,
    leads: a['lead'] || a['onsite_conversion.lead_grouped'] || a['offsite_conversion.fb_pixel_lead'] || 0,
    video: a['video_view'] || 0,
    reacciones: a['post_reaction'] || 0,
    comentarios: a['comment'] || 0,
    compartidos: a['post'] || 0,
  };
}

/** ¿Capa de marca o de captación? Una de mensajes o leads siempre es captación. Pura. */
export function capaDe(objetivo, acc) {
  if (acc?.conversaciones || acc?.leads) return 'captacion';
  return OBJ_MARCA.has(String(objetivo || '').toUpperCase()) ? 'marca' : 'captacion';
}

async function insights(fila, nivel, campos, desde, hasta) {
  const act = String(fila.account_id || '').replace(/^act_/, '');
  const rango = encodeURIComponent(JSON.stringify({ since: desde, until: hasta }));
  const url = `${GRAPH}/act_${act}/insights?level=${nivel}&time_range=${rango}&fields=${campos}&limit=300&access_token=${encodeURIComponent(fila.access_token)}`;
  const d = await fetch(url).then(r => r.json()).catch(() => ({}));
  if (d.error) throw new Error('meta: ' + String(d.error.message || '').slice(0, 160));
  return d.data || [];
}

// La miniatura de Meta es una URL firmada que caduca: el reporte congelado
// dejaría de ver la imagen en unas semanas. Se guarda la imagen misma, pequeña.
async function incrustar(url) {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const tipo = r.headers.get('content-type') || 'image/jpeg';
    if (!/^image\//.test(tipo)) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length > 150000) return null;
    let bin = '';
    for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode(...buf.subarray(i, i + 8192));
    return 'data:' + tipo + ';base64,' + btoa(bin);
  } catch { return null; }
}

/** Todo lo de Meta de una cuenta en un período, más los totales del anterior. */
export async function metaDelPeriodo(fila, per) {
  const camposC = 'campaign_id,campaign_name,objective,spend,impressions,reach,frequency,cpm,clicks,inline_link_click_ctr,actions,account_currency';
  const [camp, campAnt, conj, anun] = await Promise.all([
    insights(fila, 'campaign', camposC, per.desde, per.hasta),
    insights(fila, 'campaign', camposC, per.anterior.desde, per.anterior.hasta).catch(() => []),
    insights(fila, 'adset', 'adset_id,adset_name,campaign_id,spend,impressions,inline_link_click_ctr,actions', per.desde, per.hasta).catch(() => []),
    insights(fila, 'ad', 'ad_id,ad_name,campaign_id,spend,impressions,inline_link_click_ctr,actions', per.desde, per.hasta).catch(() => []),
  ]);
  const fila_ = (f) => {
    const acc = accionesDe(f.actions);
    return { inversion: n(f.spend), impresiones: n(f.impressions), alcance: n(f.reach), frecuencia: n(f.frequency), cpm: n(f.cpm),
      clics: n(f.clicks), ctr: n(f.inline_link_click_ctr), ...acc };
  };
  const ant = new Map(campAnt.map(f => [String(f.campaign_id), fila_(f)]));
  const campanas = camp.map(f => {
    const x = fila_(f);
    return { id: String(f.campaign_id), nombre: f.campaign_name, objetivo: f.objective, capa: capaDe(f.objective, x), ...x, anterior: ant.get(String(f.campaign_id)) || null };
  }).filter(c => c.inversion > 0).sort((a, b) => b.inversion - a.inversion);
  const capas = { marca: [], captacion: [] };
  for (const c of campanas) capas[c.capa].push(c.id);

  const conjuntos = conj.map(f => ({ id: String(f.adset_id), nombre: f.adset_name, campana_id: String(f.campaign_id), ...fila_(f) }))
    .filter(c => c.inversion > 0).sort((a, b) => (b.conversaciones + b.leads) - (a.conversaciones + a.leads) || b.inversion - a.inversion).slice(0, 15);

  let anuncios = anun.map(f => ({ id: String(f.ad_id), nombre: f.ad_name, campana_id: String(f.campaign_id), ...fila_(f) }))
    .filter(a => a.inversion > 0).sort((a, b) => (b.conversaciones + b.leads) - (a.conversaciones + a.leads) || b.inversion - a.inversion);
  // Imagen y texto de los 6 que más contactos abrieron.
  const top = anuncios.slice(0, 6);
  if (top.length) {
    // Uno por anuncio: el parámetro `ids` (varios de una vez) Meta lo retiró.
    await Promise.all(top.map(async (a) => {
      try {
        const d = await fetch(`${GRAPH}/${a.id}?fields=creative{thumbnail_url,image_url,body,title}&thumbnail_width=480&thumbnail_height=480&access_token=${encodeURIComponent(fila.access_token)}`).then(r => r.json());
        const cr = d?.creative || {};
        a.imagen = await incrustar(cr.image_url || cr.thumbnail_url);
        a.texto = String(cr.body || cr.title || '').slice(0, 280) || null;
      } catch { /* sin imagen se pinta igual */ }
    }));
  }
  anuncios = anuncios.slice(0, 20);

  const suma = (lista, k) => lista.reduce((s, c) => s + (c[k] || 0), 0);
  const totCapa = (ids, fuente) => {
    const ls = fuente.filter(c => ids.includes(c.id));
    const inv = suma(ls, 'inversion'), imp = suma(ls, 'impresiones');
    return { inversion: inv, impresiones: imp, alcance: suma(ls, 'alcance'), video: suma(ls, 'video'), conversaciones: suma(ls, 'conversaciones'),
      leads: suma(ls, 'leads'), cpm: imp ? inv / imp * 1000 : null, frecuencia: ls.length === 1 ? ls[0].frecuencia : null };
  };
  const anteriores = campanas.map(c => c.anterior ? { id: c.id, ...c.anterior } : null).filter(Boolean);
  return {
    cuenta: fila.account_name || fila.account_id,
    moneda: camp.find(f => f.account_currency)?.account_currency || null,
    campanas, conjuntos, anuncios,
    capas: {
      marca: { ...totCapa(capas.marca, campanas), anterior: totCapa(capas.marca, anteriores) },
      captacion: { ...totCapa(capas.captacion, campanas), anterior: totCapa(capas.captacion, anteriores) },
    },
    totales: { inversion: suma(campanas, 'inversion'), impresiones: suma(campanas, 'impresiones'), alcance: suma(campanas, 'alcance'),
      video: suma(campanas, 'video'), conversaciones: suma(campanas, 'conversaciones'), leads: suma(campanas, 'leads'), clics: suma(campanas, 'clics') },
    totales_anterior: { inversion: suma(campAnt.map(fila_), 'inversion'), alcance: suma(campAnt.map(fila_), 'alcance'), video: suma(campAnt.map(fila_), 'video'),
      conversaciones: suma(campAnt.map(fila_), 'conversaciones'), leads: suma(campAnt.map(fila_), 'leads'), impresiones: suma(campAnt.map(fila_), 'impresiones') },
  };
}

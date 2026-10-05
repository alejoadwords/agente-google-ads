// api/_analista.js — Analista IA de la pauta (punto 7)
//
// Un analista que mira la cuenta entera —las campañas con su lado del CRM, las
// búsquedas que se cuelan, qué palabras clave traen leads que se pierden, las
// alertas y lo que ya se decidió antes— y dice qué haría, en orden.
//
// Lo que propone y se puede hacer (pausar, bajar presupuesto, excluir una
// búsqueda) entra como PROPUESTA en acciones_pauta, con el mismo Aprobar /
// Descartar de las reglas. Nada se ejecuta solo.
//
// El modelo no es de fiar para los identificadores: puede inventar un id de
// campaña o una búsqueda que nunca existió. `validarRecomendaciones` solo deja
// pasar como acción lo que está en la foto que vio: una campaña activa de la
// cuenta, o una búsqueda que el análisis del punto 6 ya marcó como candidata.
// Todo lo demás baja a consejo, sin botón.
//
// SOLO desde funciones edge (regla 2 de CLAUDE.md).

import { conexionesDe, leadsDelPeriodo, claveDeLead } from './pauta.js';
import { campanasDeVentana } from './_reglas-pauta.js';
import { leerBusquedas, analizarTerminos, calidadPorPalabra, norm } from './_busquedas.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = (extra = {}) => ({ 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, ...extra });
async function sb(ruta, init) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, { headers: sbH(), ...(init || {}) });
  if (!r.ok) throw new Error('Supabase ' + r.status + ' en ' + ruta.split('?')[0]);
  return r.status === 204 ? null : r.json().catch(() => null);
}

export const MODELO = 'claude-sonnet-5';
// Revisiones al mes. Freno de gasto, no límite comercial: una revisión cuesta
// unos 0,05 USD (≈12.000 tokens de entrada y 2.000 de salida).
export const CUPOS = { free: 1, trial: 10, pro: 10, agency: 40 };
export const NOMBRE = 'Analista IA';
const MAX_RECS = 8;

const activa = e => ['enabled', 'active'].includes(String(e || '').toLowerCase());
const r0 = (n) => Math.round(Number(n || 0));
const r1 = (n) => Math.round(Number(n || 0) * 10) / 10;
const dia = (ms) => new Date(ms - 5 * 3600000).toISOString().slice(0, 10);

// El perfil que el cliente llenó (industria, productos, competidores…). Sin
// él, el modelo adivinaba el giro por el nombre: a una funeraria de mascotas
// le propuso excluir «cremación de mascotas» por «ajena al negocio».
const CAMPOS_PERFIL = ['name', 'industria', 'descripcion', 'business', 'productos', 'tipoOferta', 'objetivo', 'ticket', 'ciclo',
  'audiencia', 'ciudad', 'pais', 'competidores', 'keywordsMarca', 'diferenciador', 'web'];
export async function perfilDelNegocio(userId, clientId) {
  try {
    const [f] = await sb(`/user_profiles?user_id=eq.${encodeURIComponent(userId)}&agent_key=eq.__agency_clients__&select=profile_data&limit=1`) || [];
    const lista = f?.profile_data?.clients || [];
    const c = (clientId && lista.find(x => x.id === clientId)) || lista.find(x => x.id === 'pro_main') || (lista.length === 1 ? lista[0] : null);
    if (!c) return null;
    const out = {};
    for (const k of CAMPOS_PERFIL) if (c[k] && String(c[k]).trim()) out[k] = String(c[k]).trim().slice(0, 300);
    return Object.keys(out).length ? out : null;
  } catch { return null; }
}

/** Todo lo que el analista ve. Compacto: cada número de más son tokens. */
export async function fotoDeCuenta(userId, clientId, sueltasTambien = true) {
  const conexiones = (await conexionesDe(userId, clientId, sueltasTambien)).filter(c => c.account_id);
  if (!conexiones.length) return { campanas: [], busquedas: [], vacia: 'sin_conexion' };
  const perfil = await perfilDelNegocio(userId, clientId);
  const marcaExtra = String(perfil?.keywordsMarca || '').split(/[,;\n]+/).map(x => x.trim()).filter(Boolean);
  const [c30, c7] = await Promise.all([campanasDeVentana(userId, conexiones, 30), campanasDeVentana(userId, conexiones, 7)]);
  const de7 = new Map(c7.map(c => [c.red + ':' + c.id, c]));
  const ventana = (c) => c ? { inversion: r0(c.inv), clics: c.clics, conv_red: r1(c.conv_red), leads_crm: c.leads, ganados: c.ganados, perdidos: c.perdidos, en_proceso: c.en_proceso, ingresos: r0(c.ingresos) } : null;
  const campanas = c30
    .filter(c => c.inv > 0 || c.leads > 0)
    .sort((a, b) => b.inv - a.inv).slice(0, 40)
    .map(c => ({ red: c.red, id: String(c.id), nombre: c.nombre, estado: String(c.estado || '').toLowerCase(), objetivo: c.objetivo || null,
      moneda: c.moneda, conexion_id: c.conexion_id, ultimos_30: ventana(c), ultimos_7: ventana(de7.get(c.red + ':' + c.id)) }));

  const hasta = dia(Date.now() - 86400000), desde30 = dia(Date.now() - 30 * 86400000);
  const busquedas = await Promise.all(conexiones.filter(c => c.platform === 'google_ads').map(async (c) => {
    try {
      const d = await leerBusquedas(c, desde30, hasta);
      const a = analizarTerminos({ ...d, marca: [c.account_name, perfil?.name, ...marcaExtra].filter(Boolean) });
      return {
        conexion_id: c.id, cuenta: c.account_name, modo: a.modo, costo_por_conversion: a.cpl ? r0(a.cpl) : null, crm_en_google: d.crmActivo,
        // Lo que el negocio SÍ busca: el giro se lee aquí, no en el nombre de la cuenta.
        palabras_clave: [...new Set(d.claves.map(x => String(x).toLowerCase()))].slice(0, 40),
        palabras: a.palabras.slice(0, 12).map(p => ({ texto: p.texto, costo: r0(p.costo), clics: p.clics, conv: r1(p.conv), motivo: p.motivo, ejemplos: p.ejemplos, campanas: p.campanas.map(x => x.id) })),
        busquedas: a.terminos.slice(0, 12).map(t => ({ texto: t.texto, campana_id: t.campanaId, costo: r0(t.costo), clics: t.clics, conv: r1(t.conv), motivo: t.motivo, de_tu_negocio: t.propia })),
      };
    } catch (e) {
      return { conexion_id: c.id, cuenta: c.account_name, error: 'No se pudieron leer las búsquedas.' };
    }
  }));

  // Del CRM: qué palabras traen leads que se pierden, y por qué se pierden
  // los leads que vinieron de pauta.
  const leads = await leadsDelPeriodo(userId, clientId, dia(Date.now() - 90 * 86400000), dia(Date.now()), null);
  const desde = Date.now() - 30 * 86400000;
  const motivos = {};
  // Cuántos leads del período NO dicen de qué campaña vienen, y por dónde
  // entraron. Si son muchos, «la campaña no trae leads» puede ser solo que
  // sus leads llegan sin la etiqueta: no es lo mismo, y el modelo lo tiene que saber.
  const atribucion = { total: 0, con_campana: 0, sin_campana: 0, sin_campana_por_fuente: {} };
  for (const l of leads) {
    if (Date.parse(l.created_at) < desde) continue;
    atribucion.total++;
    if (claveDeLead(l)) { atribucion.con_campana++; continue; }
    atribucion.sin_campana++;
    const f = String(l.source || 'sin fuente').slice(0, 40);
    atribucion.sin_campana_por_fuente[f] = (atribucion.sin_campana_por_fuente[f] || 0) + 1;
  }
  for (const l of leads) {
    if (!claveDeLead(l) || Date.parse(l.created_at) < desde) continue;
    if (!['perdido', 'lost', 'descartado'].includes(String(l.stage || '').toLowerCase())) continue;
    const m = String(l.close_reason || 'Sin motivo').trim();
    motivos[m] = (motivos[m] || 0) + 1;
  }
  const uid = encodeURIComponent(userId);
  const hace = (d) => encodeURIComponent(new Date(Date.now() - d * 86400000).toISOString());
  const [alertas, acciones] = await Promise.all([
    sb(`/alertas_pauta?user_id=eq.${uid}&created_at=gte.${hace(7)}&select=red,campana,titulo&order=created_at.desc&limit=15`).catch(() => []),
    sb(`/acciones_pauta?user_id=eq.${uid}&created_at=gte.${hace(30)}&select=accion,red,campana,campana_id,estado,regla,detalle&order=created_at.desc&limit=40`).catch(() => []),
  ]);
  return {
    hoy: dia(Date.now()),
    negocio: perfil,
    moneda: campanas.find(c => c.moneda)?.moneda || null,
    campanas,
    busquedas,
    palabras_clave_crm: calidadPorPalabra(leads).slice(0, 15),
    leads_crm_30d: atribucion,
    motivos_perdida_pauta_30d: Object.entries(motivos).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([motivo, n]) => ({ motivo, n })),
    alertas_7d: alertas || [],
    decisiones_30d: (acciones || []).map(a => ({ accion: a.accion, red: a.red, campana: a.campana, campana_id: a.campana_id, estado: a.estado, origen: a.regla, texto: a.detalle?.texto || undefined })),
    ...(campanas.length ? {} : { vacia: 'sin_gasto' }),
  };
}

/**
 * Deja pasar como acción solo lo que existe en la foto. Pura.
 * @returns [{ titulo, por_que, prioridad, tipo, acciones: [{accion, red, conexion_id, campana_id, campana, porcentaje, detalle}], nota }]
 */
export function validarRecomendaciones(recs, foto) {
  const camp = new Map((foto.campanas || []).map(c => [String(c.id), c]));
  const candidatas = new Map();
  for (const b of foto.busquedas || []) {
    if (b.error) continue;
    for (const p of b.palabras || []) candidatas.set(norm(p.texto), { texto: p.texto, tipo: 'PHRASE', conexion_id: b.conexion_id, campanas: p.campanas });
    for (const t of b.busquedas || []) {
      const k = norm(t.texto);
      if (!candidatas.has(k)) candidatas.set(k, { texto: t.texto, tipo: 'EXACT', conexion_id: b.conexion_id, campanas: [t.campana_id], propia: !!t.de_tu_negocio });
    }
  }
  // Lo que ya espera aprobación no se propone dos veces.
  const yaPendiente = new Set((foto.decisiones_30d || []).filter(d => d.estado === 'propuesta')
    .map(d => d.accion + ':' + d.campana_id + ':' + norm(d.texto || '')));
  const vistas = new Set();
  const out = [];
  for (const r of (Array.isArray(recs) ? recs : []).slice(0, MAX_RECS)) {
    const base = {
      titulo: String(r?.titulo || '').trim().slice(0, 160),
      por_que: String(r?.por_que || '').trim().slice(0, 700),
      prioridad: ['alta', 'media', 'baja'].includes(r?.prioridad) ? r.prioridad : 'media',
    };
    if (!base.titulo) continue;
    const tipo = String(r?.tipo || 'consejo');
    let acciones = [], nota = null;
    if (tipo === 'pausar' || tipo === 'bajar_presupuesto') {
      const c = camp.get(String(r?.campana_id || '').replace(/\D/g, ''));
      if (!c) nota = 'No se encontró esa campaña en los datos: queda como consejo.';
      else if (!activa(c.estado)) nota = 'Esa campaña ya no está activa.';
      else if (!c.conexion_id) nota = 'No se sabe con qué cuenta publicitaria cambiarla.';
      // La red dice que convierte y el CRM no tiene ni un lead suyo: lo más
      // probable es que sus leads no estén entrando al CRM, no que sea mala.
      // Recortarla por eso sería castigar a la campaña por un formulario suelto.
      else if ((c.ultimos_30?.conv_red || 0) >= 3 && !(c.ultimos_30?.leads_crm)) nota = 'La red le cuenta ' + c.ultimos_30.conv_red + ' conversiones y tu CRM no tiene ni un lead suyo: primero hay que conectar la captura de esos leads. Mientras tanto no la tocamos.';
      else acciones = [{
        accion: tipo, red: c.red, conexion_id: c.conexion_id, campana_id: c.id, campana: c.nombre,
        porcentaje: tipo === 'bajar_presupuesto' ? Math.min(50, Math.max(5, Math.round(Number(r?.porcentaje) || 20))) : null,
      }];
    } else if (tipo === 'negativa') {
      const cand = candidatas.get(norm(r?.texto_negativa || ''));
      if (!cand) nota = 'Solo se pueden excluir búsquedas que aparecen en tus datos: queda como consejo.';
      // Todas sus palabras están en tus palabras clave: es tu negocio. Diga lo
      // que diga el modelo, eso no se excluye desde aquí.
      else if (cand.propia) nota = 'Es una búsqueda de tu propio negocio (todas sus palabras están en tus palabras clave): no la excluimos. Si no convierte, revisa el anuncio o la página.';
      else {
        const pedida = String(r?.campana_id || '').replace(/\D/g, '');
        const ids = pedida && cand.campanas.includes(pedida) ? [pedida] : cand.campanas;
        acciones = ids.map(id => ({
          accion: 'negativa', red: 'google', conexion_id: cand.conexion_id, campana_id: String(id), campana: camp.get(String(id))?.nombre || null,
          porcentaje: null, detalle: { texto: cand.texto, tipo: cand.tipo },
        }));
      }
    }
    acciones = acciones.filter(a => {
      const k = a.accion + ':' + a.campana_id + ':' + norm(a.detalle?.texto || '');
      if (vistas.has(k)) return false;
      vistas.add(k);
      if (yaPendiente.has(k)) { nota = 'Ya hay una propuesta igual esperando tu aprobación.'; return false; }
      return true;
    });
    out.push({ ...base, tipo: acciones.length ? tipo : 'consejo', acciones, nota });
  }
  return out;
}

const SISTEMA = `Eres el analista de pauta de Acuarius, un CRM para negocios y agencias de Latinoamérica. Revisas la cuenta publicitaria (Google Ads y Meta) de un cliente con los datos de su CRM al lado: no solo lo que reporta la red, sino cuántos de esos leads entraron, avanzaron, se ganaron o se perdieron, y por qué.

Tu trabajo: decir en orden qué haría un experto esta semana con ESTA cuenta.

Reglas:
- Primero entiende el negocio: lee "negocio" (el perfil que llenó el cliente) y las "palabras_clave" de Google. El giro se deduce de ahí y de los nombres de las campañas, nunca solo del nombre de la cuenta. Una búsqueda con "de_tu_negocio": true, o hecha de las mismas palabras que sus palabras clave, ES del negocio: jamás la llames ajena ni la propongas como negativa; si no convierte, el problema es el anuncio, la página o la medición.
- Usa solo los datos que te doy. Cada recomendación cita los números que la sostienen (gasto, leads del CRM, ventas, costo por lead real, búsquedas). Nunca inventes una cifra, una campaña ni una búsqueda.
- Las acciones que se pueden ejecutar son solo tres, y todas restan: "pausar" una campaña activa, "bajar_presupuesto" (porcentaje entre 5 y 50) o "negativa" (excluir una búsqueda o palabra de Google). Para las dos primeras da el campana_id exacto de los datos. Para "negativa" usa exactamente el texto de una de las palabras o búsquedas listadas en "busquedas"; ninguna otra, y una sola por recomendación (si son dos, son dos recomendaciones).
- Nunca propongas activar campañas ni subir presupuestos como acción. Si conviene invertir más en algo, dilo como "consejo".
- Todo lo demás (anuncios, páginas, segmentación, medición, seguimiento comercial de los leads) va como "consejo".
- Si la red reporta conversiones de una campaña y el CRM no tiene ningún lead suyo, lo más probable es que esos leads no estén entrando al CRM (formulario, WhatsApp o fuente sin conectar). Eso es un consejo prioritario; NO pauses ni bajes esa campaña por esa razón.
- Mira "leads_crm_30d": si muchos leads del período entraron sin campaña, los números de leads por campaña se quedan cortos y una campaña puede parecer peor de lo que es. En ese caso no recortes por «pocos leads»: recomienda primero etiquetar la campaña de origen (UTM, gclid, formulario).
- Si el perfil del "negocio" contradice lo que muestran las palabras clave y campañas, dilo: puede ser un perfil desactualizado.
- Sé prudente: con pocos días o pocos datos, dilo y no pauses. No pauses una campaña que trae ventas en el CRM aunque su costo por lead sea alto. Si "decisiones_30d" muestra que algo se descartó, no lo vuelvas a proponer.
- Si "modo" de las búsquedas es "gasto", la cuenta no mide conversiones en Google: dilo como problema prioritario. Puedes proponer como negativa las palabras que claramente no son del negocio (portales, competidores, empleo, gratis, "dueño directo" para una inmobiliaria), explicando por qué.
- Si Meta aparece sin gasto o sin datos, no lo trates como un error del cliente.
- Máximo ${MAX_RECS} recomendaciones, las de más impacto primero. Mejor tres buenas que ocho de relleno.
- Español de Latinoamérica, claro y directo, para el dueño de un negocio. Montos en la moneda de la cuenta con separador de miles.

Entrega el resultado con la herramienta entregar_revision.`;

const HERRAMIENTA = {
  name: 'entregar_revision',
  description: 'Entrega la revisión de la cuenta.',
  input_schema: {
    type: 'object',
    properties: {
      resumen: { type: 'string', description: 'Tres a cinco frases: cómo está la cuenta y lo más importante.' },
      recomendaciones: {
        type: 'array', maxItems: MAX_RECS,
        items: {
          type: 'object',
          properties: {
            titulo: { type: 'string', description: 'Qué hacer, en una línea.' },
            por_que: { type: 'string', description: 'Los números que lo sostienen.' },
            prioridad: { type: 'string', enum: ['alta', 'media', 'baja'] },
            tipo: { type: 'string', enum: ['pausar', 'bajar_presupuesto', 'negativa', 'consejo'] },
            red: { type: 'string', enum: ['google', 'meta'] },
            campana_id: { type: 'string' },
            porcentaje: { type: 'integer' },
            texto_negativa: { type: 'string' },
          },
          required: ['titulo', 'por_que', 'prioridad', 'tipo'],
        },
      },
    },
    required: ['resumen', 'recomendaciones'],
  },
};

/** Le pide la revisión al modelo. Devuelve { resumen, recomendaciones, uso, modelo } o { error }. */
export async function pedirRevision(foto) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { error: 'Falta la clave de la IA en el servidor.' };
  const datos = { ...foto };
  delete datos.vacia;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODELO,
      max_tokens: 4000,
      system: SISTEMA,
      tools: [HERRAMIENTA],
      tool_choice: { type: 'tool', name: HERRAMIENTA.name },
      messages: [{ role: 'user', content: 'Datos de la cuenta (JSON):\n' + JSON.stringify(datos) }],
    }),
  }).catch(e => ({ ok: false, status: 0, text: async () => String(e?.message || e) }));
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    console.error('[analista] anthropic', r.status, t.slice(0, 300));
    return { error: r.status === 529 || r.status === 429 ? 'La IA está saturada en este momento. Vuelve a intentarlo en unos minutos.' : 'La IA no respondió. Vuelve a intentarlo en un momento.' };
  }
  const d = await r.json();
  const uso = d.usage, modelo = d.model;
  const bloque = (d.content || []).find(b => b.type === 'tool_use');
  // Se cortó por max_tokens: lo que llegó está a medias y no se usa.
  if (!bloque || d.stop_reason === 'max_tokens') return { error: 'La revisión llegó incompleta. Vuelve a intentarlo.', uso, modelo };
  return { resumen: String(bloque.input?.resumen || '').slice(0, 1500), recomendaciones: bloque.input?.recomendaciones || [], uso, modelo };
}

/**
 * Reserva la fila de la revisión ANTES de llamar al modelo: así un segundo
 * clic mientras se piensa la ve y no paga otra. Sin resumen = en curso.
 */
export async function reservarRevision({ userId, clientId, pedidaPor }) {
  const [rev] = await sb('/revisiones_pauta', {
    method: 'POST', headers: sbH({ Prefer: 'return=representation' }),
    body: JSON.stringify({ user_id: userId, client_id: clientId || null, pedida_por: pedidaPor }),
  }) || [];
  if (!rev) throw new Error('No se pudo reservar la revisión');
  return rev;
}

/** Una revisión que no llegó a nada queda marcada, con el porqué. */
export async function revisionFallida(id, motivo) {
  await sb(`/revisiones_pauta?id=eq.${id}`, { method: 'PATCH', headers: sbH({ Prefer: 'return=minimal' }), body: JSON.stringify({ datos: { error: motivo } }) }).catch(() => {});
}

/** Completa la revisión reservada y crea las propuestas. */
export async function guardarRevision({ rev, userId, clientId, foto, resumen, recs, modelo, costo }) {
  await sb(`/revisiones_pauta?id=eq.${rev.id}`, {
    method: 'PATCH', headers: sbH({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ resumen, recomendaciones: recs, datos: foto, modelo, costo }),
  });
  rev = { ...rev, resumen, recomendaciones: recs };
  const filas = recs.flatMap((r, i) => r.acciones.map(a => ({
    user_id: userId, client_id: clientId || null, regla: NOMBRE, red: a.red, conexion_id: a.conexion_id,
    campana_id: a.campana_id, campana: a.campana, accion: a.accion, porcentaje: a.porcentaje,
    motivo: (r.titulo + '. ' + r.por_que).slice(0, 900), estado: 'propuesta',
    detalle: { ...(a.detalle || {}), revision_id: rev.id, recomendacion: i },
  })));
  if (filas.length) {
    const creadas = await sb('/acciones_pauta', { method: 'POST', headers: sbH({ Prefer: 'return=representation' }), body: JSON.stringify(filas) }) || [];
    for (const c of creadas) {
      const r = recs[c.detalle?.recomendacion];
      if (r) (r.accion_ids = r.accion_ids || []).push(c.id);
    }
    await sb(`/revisiones_pauta?id=eq.${rev.id}`, { method: 'PATCH', headers: sbH({ Prefer: 'return=minimal' }), body: JSON.stringify({ recomendaciones: recs }) });
    rev.recomendaciones = recs;
  }
  return rev;
}

// api/voz.js — hablarle al CRM.
//
// Recibe lo que alguien dijo en voz alta desde el teléfono y responde con una
// tarjeta ya armada, más una frase para leer en voz alta.
//
// EL MODELO NO CUENTA NI INVENTA. Se le pide una sola cosa: entender QUÉ pidió
// y A QUIÉN se refiere, contra la lista real de leads de esa cuenta. Los
// números, las fechas y los textos los arma este archivo consultando la base.
// Un asistente que se equivoca en «atendiste 14» y suena igual de seguro que
// cuando acierta es peor que no tenerlo.
//
// Fase 1: solo CONSULTA. No escribe nada. Ver `INTENCIONES`.

export const config = { runtime: 'edge' };

import { quienPregunta, soloSusLeads } from './_perfiles.js';
import { registrarUso, cuentaDe } from './_uso-ia.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TZ = 'America/Bogota';

function sbHeaders() {
  return { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
}
function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
async function sb(ruta) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, { headers: sbHeaders() });
  if (!r.ok) throw new Error('supabase ' + r.status);
  return r.json();
}

// Verificación del JWT de Clerk (mismo patrón que api/leads.js)
async function getUserId(req) {
  const auth = req.headers.get('Authorization');
  if (!auth) return null;
  const token = auth.replace('Bearer ', '');
  try {
    const [hB64, pB64, sB64] = token.split('.');
    if (!sB64) return null;
    const header = JSON.parse(atob(hB64.replace(/-/g, '+').replace(/_/g, '/')));
    const jwks = await fetch('https://clerk.acuarius.app/.well-known/jwks.json').then(r => r.json());
    const key = jwks.keys?.find(k => k.kid === header.kid);
    if (!key) return null;
    const ck = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const sig = Uint8Array.from(atob(sB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', ck, sig, new TextEncoder().encode(`${hB64}.${pB64}`));
    if (!ok) return null;
    const p = JSON.parse(atob(pB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (p.exp && p.exp < Math.floor(Date.now() / 1000)) return null;
    return p.sub || null;
  } catch { return null; }
}

// Quién tiene la función encendida. En una variable de entorno y no en el
// código para poder sumar gente sin desplegar.
function enLaBeta(id) {
  const lista = String(process.env.VOZ_BETA || '').split(',').map(s => s.trim()).filter(Boolean);
  return lista.includes(id);
}

// ── Fechas en la hora de quien pregunta, no del servidor ────────────────────
function hoyLocal() {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(new Date());                       // AAAA-MM-DD
}
function diaMas(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function bonita(iso) {
  const M = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const [a, m, d] = iso.split('-');
  return `${Number(d)} de ${M[Number(m) - 1]}`;
}
function haceCuanto(iso) {
  const dias = Math.round((Date.parse(hoyLocal() + 'T12:00:00Z') - Date.parse(String(iso).slice(0, 10) + 'T12:00:00Z')) / 86400000);
  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'ayer';
  return `hace ${dias} días`;
}
function hora(iso) {
  try {
    return new Intl.DateTimeFormat('es-CO', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
  } catch { return ''; }
}

// ── Lo que el modelo puede pedir ────────────────────────────────────────────
const INTENCIONES = [
  'pendientes',        // tareas de hoy y vencidas
  'fase_lead',         // en qué etapa está alguien
  'ultima_interaccion',
  'notas_lead',
  'datos_lead',        // teléfono / correo
  'atendidos',         // cuántos leads trabajé en un periodo
  'sin_tocar',         // leads abandonados
  'ambiguo',           // el nombre se parece a varios
  'fuera_de_alcance',  // pide escribir algo: esta fase no lo hace
  'no_entendido',
];

const INSTRUCCIONES = `Clasificas lo que un comercial dijo en voz alta a su CRM. NO respondes su pregunta: solo dices qué pidió.

Devuelve SOLO un objeto JSON:
{"intencion":"<una de la lista>","lead_id":"<id exacto o null>","candidatos":["id","id"],"dias":<número o null>,"desde":"AAAA-MM-DD","hasta":"AAAA-MM-DD"}

Intenciones: ${INTENCIONES.join(', ')}.

Reglas:
- "lead_id" SOLO si estás seguro de a quién se refiere. El reconocimiento de voz deforma los nombres: "Daisy" puede ser "Deysy", "Jorge Acosta" puede llegar como "Jorge a Costa".
- Si el nombre se parece a VARIOS leads o no estás seguro, usa intencion "ambiguo" y pon hasta 3 ids en "candidatos".
- Si no se parece a ninguno, "no_entendido".
- Si pide CREAR, MOVER, ASIGNAR, BORRAR o MANDAR algo: "fuera_de_alcance".
- Para periodos ("la semana pasada", "este mes", "ayer") calcula "desde" y "hasta" a partir de la fecha de hoy que te doy. La semana va de lunes a domingo.
- Para "sin_tocar", "dias" es el umbral que pidieron; si no dijeron, 7.`;

async function clasificar(texto, contexto, apiKey) {
  const prompt = INSTRUCCIONES +
    `\n\nHOY ES ${contexto.hoy} (${contexto.diaSemana}).` +
    `\n\nSUS LEADS (id · nombre · etapa):\n` +
    contexto.leads.map(l => `${l.id} · ${l.name} · ${l.stage}`).join('\n') +
    `\n\nLO QUE DIJO:\n"${texto}"`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!r.ok) throw new Error('anthropic ' + r.status);
  const d = await r.json();
  const txt = d.content?.[0]?.text || '';
  const m = txt.match(/\{[\s\S]*\}/);
  return { plan: m ? JSON.parse(m[0]) : null, uso: d.usage, modelo: d.model };
}

// ── Las respuestas. Cada una consulta la base y arma su tarjeta ─────────────
async function responder(plan, ctx) {
  const { userId, actorId, filtroMios, leads } = ctx;
  const lead = plan.lead_id ? leads.find(l => l.id === plan.lead_id) : null;

  switch (plan.intencion) {

    case 'pendientes': {
      const hasta = hoyLocal() + 'T23:59:59Z';
      const filas = await sb(`/activities?user_id=eq.${userId}&done=is.false&cancelled_at=is.null` +
        `&due_at=lte.${encodeURIComponent(hasta)}&select=title,due_at,lead_id&order=due_at.asc&limit=40`);
      const mios = new Set(leads.map(l => l.id));
      const suyas = filas.filter(t => !t.lead_id || mios.has(t.lead_id));
      if (!suyas.length) return { etiqueta: 'Agenda', voz: 'No tienes nada pendiente para hoy.' };
      const vencidas = suyas.filter(t => Date.parse(t.due_at) < Date.now());
      return {
        etiqueta: 'Agenda',
        voz: `Tienes ${suyas.length} ${suyas.length === 1 ? 'pendiente' : 'pendientes'}` +
             (vencidas.length ? `, ${vencidas.length} ${vencidas.length === 1 ? 'vencido' : 'vencidos'}.` : '.'),
        filas: suyas.slice(0, 8).map(t => ({
          titulo: t.title,
          detalle: Date.parse(t.due_at) < Date.now() ? 'Venció ' + haceCuanto(t.due_at) + ' · ' + hora(t.due_at) : 'Hoy ' + hora(t.due_at),
          alerta: Date.parse(t.due_at) < Date.now(),
        })),
        acciones: ['Abrir la agenda'],
      };
    }

    case 'fase_lead': {
      if (!lead) return sinLead();
      const etapas = ctx.etapasDe(lead.pipeline_id);
      return {
        etiqueta: 'Lead',
        voz: `${lead.name} está en ${lead.etiquetaEtapa}` + (lead.tablero ? `, en el tablero ${lead.tablero}.` : '.'),
        escalera: { etapas: etapas.length ? etapas : [lead.etiquetaEtapa], actual: lead.etiquetaEtapa },
        acciones: ['Abrir su ficha'],
        lead_id: lead.id,
      };
    }

    case 'ultima_interaccion': {
      if (!lead) return sinLead();
      const act = await sb(`/lead_activities?lead_id=eq.${lead.id}&user_id=eq.${userId}` +
        `&select=type,content,created_at&order=created_at.desc&limit=1`);
      if (!act.length) {
        return { etiqueta: 'Historial', voz: `No hay nada registrado con ${lead.name} todavía.`,
                 acciones: ['Abrir su ficha'], lead_id: lead.id };
      }
      const a = act[0];
      return {
        etiqueta: 'Historial',
        voz: `La última con ${lead.name} fue ${haceCuanto(a.created_at)}: ${a.type}.`,
        filas: [{ titulo: capitaliza(a.type) + ' · ' + bonita(String(a.created_at).slice(0, 10)),
                  detalle: (a.content || '').slice(0, 220) }],
        acciones: ['Abrir su ficha'],
        lead_id: lead.id,
      };
    }

    case 'notas_lead': {
      if (!lead) return sinLead();
      const filas = await sb(`/leads?id=eq.${lead.id}&user_id=eq.${userId}&select=notes`);
      const notas = (filas?.[0]?.notes || '').trim();
      if (!notas) return { etiqueta: 'Lead', voz: `${lead.name} no tiene notas.`, acciones: ['Abrir su ficha'], lead_id: lead.id };
      return {
        etiqueta: 'Lead',
        voz: notas.replace(/📥/g, '').replace(/\n+/g, '. ').slice(0, 600),
        filas: [{ titulo: 'Notas de ' + lead.name, detalle: notas.slice(0, 600) }],
        acciones: ['Abrir su ficha'],
        lead_id: lead.id,
      };
    }

    case 'datos_lead': {
      if (!lead) return sinLead();
      const filas = await sb(`/leads?id=eq.${lead.id}&user_id=eq.${userId}&select=phone,email,company`);
      const d = filas?.[0] || {};
      return {
        etiqueta: 'Lead',
        voz: d.phone ? `El teléfono de ${lead.name} es ${d.phone.split('').join(' ')}.`
                     : `${lead.name} no tiene teléfono registrado.`,
        filas: [
          d.phone ? { titulo: d.phone, detalle: 'Teléfono' } : null,
          d.email ? { titulo: d.email, detalle: 'Correo' } : null,
        ].filter(Boolean),
        acciones: d.phone ? ['Llamarlo', 'Abrir su ficha'] : ['Abrir su ficha'],
        lead_id: lead.id, telefono: d.phone || null,
      };
    }

    // Aquí el número lo cuenta el servidor, no el modelo.
    case 'atendidos': {
      const desde = plan.desde || diaMas(hoyLocal(), -7);
      const hasta = plan.hasta || hoyLocal();
      const act = await sb(`/lead_activities?user_id=eq.${userId}` +
        `&type=in.(llamada,email,reunion,nota)` +
        `&created_at=gte.${desde}T00:00:00Z&created_at=lte.${hasta}T23:59:59Z` +
        `&select=lead_id,metadata&limit=2000`);
      const mios = new Set(leads.map(l => l.id));
      const cuenta = new Set(act
        .filter(a => a.lead_id && mios.has(a.lead_id))
        .filter(a => !ctx.soloLoSuyo || !a.metadata?.actor || a.metadata.actor === actorId)
        .map(a => a.lead_id));
      return {
        etiqueta: 'Números',
        voz: `Atendiste ${cuenta.size} ${cuenta.size === 1 ? 'lead' : 'leads'} entre el ${bonita(desde)} y el ${bonita(hasta)}.`,
        cifra: String(cuenta.size),
        cifra_pie: `leads con actividad tuya · ${bonita(desde)} al ${bonita(hasta)}`,
        nota_al_pie: 'Cuento un lead cuando le registraste una llamada, un correo, una reunión o una nota.',
      };
    }

    case 'sin_tocar': {
      const dias = Number(plan.dias) > 0 ? Number(plan.dias) : 7;
      const corte = diaMas(hoyLocal(), -dias);
      const filas = await sb(`/leads?user_id=eq.${userId}&deleted_at=is.null${filtroMios}` +
        `&stage=not.in.(ganado,perdido)&updated_at=lt.${corte}T00:00:00Z` +
        `&select=id,name,stage,updated_at&order=updated_at.asc&limit=10`);
      if (!filas.length) return { etiqueta: 'Cartera', voz: `Ninguno lleva más de ${dias} días sin que lo toques. Vas al día.` };
      return {
        etiqueta: 'Cartera',
        voz: `${filas.length === 10 ? 'Al menos 10' : filas.length} ${filas.length === 1 ? 'lead lleva' : 'leads llevan'} más de ${dias} días sin movimiento.`,
        filas: filas.map(l => ({ titulo: l.name, detalle: 'Sin tocar ' + haceCuanto(l.updated_at) + ' · ' + l.stage })),
        acciones: ['Ver el tablero'],
      };
    }

    case 'ambiguo': {
      const cand = (plan.candidatos || []).map(id => leads.find(l => l.id === id)).filter(Boolean).slice(0, 3);
      if (!cand.length) return sinLead();
      return {
        etiqueta: 'Cuál de todos',
        voz: '¿A cuál te refieres?',
        aviso: 'No estoy seguro de a quién te refieres.',
        opciones: cand.map(l => ({ texto: l.name, lead_id: l.id })),
      };
    }

    case 'fuera_de_alcance':
      return {
        etiqueta: 'Todavía no',
        voz: 'Por ahora solo puedo consultar, no cambiar cosas. Eso lo tienes que hacer desde la pantalla.',
        aviso: 'Crear tareas, mover de etapa o mandar mensajes llegará más adelante, y siempre pidiéndote confirmación.',
      };

    default:
      return { etiqueta: 'No entendí', voz: 'No te entendí. ¿Me lo repites?',
               aviso: 'Prueba con «qué tengo pendiente hoy» o «en qué fase está» y el nombre de un lead.' };
  }
}

function sinLead() {
  return { etiqueta: 'No entendí', voz: 'No encontré ese lead entre los tuyos.',
           aviso: 'Puede que el micrófono haya entendido mal el nombre. Vuelve a intentarlo despacio.' };
}
function capitaliza(s) { const t = String(s || ''); return t.charAt(0).toUpperCase() + t.slice(1); }

// ── Handler ─────────────────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);

  // El navegador pregunta si tiene que pintar el botón. Se contesta rápido y
  // sin tocar nada más.
  const url = new URL(req.url);
  if (req.method === 'GET') return jsonResp({ habilitado: enLaBeta(userId) });
  if (req.method !== 'POST') return jsonResp({ error: 'Método no permitido' }, 405);
  if (!enLaBeta(userId)) return jsonResp({ error: 'No disponible', habilitado: false }, 403);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return jsonResp({ error: 'Falta la clave de IA' }, 500);

  let body = {};
  try { body = await req.json(); } catch {}
  const texto = String(body.texto || '').trim().slice(0, 500);
  if (!texto) return jsonResp({ error: 'No llegó nada que interpretar' }, 400);

  let quien;
  try { quien = await quienPregunta(userId); }
  catch { return jsonResp({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503); }

  const soloMios = quien.esMiembro && soloSusLeads(quien.perfil);
  const filtroMios = soloMios ? `&assigned_to=eq.${encodeURIComponent(quien.actorId)}` : '';

  try {
    // TODA la cuenta, no el cliente que tenga abierto. Preguntar «en qué fase
    // está Liliana Blanco» no puede exigir haber seleccionado antes el tablero
    // correcto: quien habla no está mirando la pantalla. Atarlo al ámbito hacía
    // que desde «Mi cuenta» —donde no hay leads— respondiera siempre lo mismo
    // aunque el lead existiera.
    const [leadsRaw, etapasRaw, tablerosRaw] = await Promise.all([
      sb(`/leads?user_id=eq.${quien.userId}&deleted_at=is.null${filtroMios}` +
         `&select=id,name,stage,pipeline_id&order=updated_at.desc&limit=400`),
      sb(`/pipeline_stages?user_id=eq.${quien.userId}&select=key,label,pipeline_id&order=position.asc`),
      sb(`/pipelines?user_id=eq.${quien.userId}&select=id,name`),
    ]);

    // Cada lead lleva su etapa traducida por SU tablero: dos tableros pueden
    // usar la misma clave con rótulos distintos.
    const rotulo = {};
    etapasRaw.forEach(e => { rotulo[(e.pipeline_id || '') + '|' + e.key] = e.label; });
    const nombreTablero = {};
    tablerosRaw.forEach(t => { nombreTablero[t.id] = t.name; });

    const leads = leadsRaw.map(l => {
      const etiqueta = rotulo[(l.pipeline_id || '') + '|' + l.stage] || l.stage;
      return { id: l.id, name: l.name, stage: etiqueta, etiquetaEtapa: etiqueta,
               pipeline_id: l.pipeline_id, tablero: nombreTablero[l.pipeline_id] || null };
    });

    if (!leads.length) {
      return jsonResp({ etiqueta: 'Sin leads',
        voz: quien.esMiembro && soloMios
          ? 'Todavía no tienes leads a tu nombre. Pídele al administrador que te reparta los tuyos.'
          : 'Todavía no hay leads en esta cuenta.' });
    }

    const hoy = hoyLocal();
    const diaSemana = new Intl.DateTimeFormat('es-CO', { timeZone: TZ, weekday: 'long' }).format(new Date());

    const { plan, uso, modelo } = await clasificar(texto, { hoy, diaSemana, leads }, apiKey);
    if (!plan) return jsonResp({ etiqueta: 'No entendí', voz: 'No te entendí. ¿Me lo repites?' });

    const resp = await responder(plan, {
      userId: quien.userId, actorId: quien.actorId, filtroMios, leads,
      etapasDe: (pid) => etapasRaw.filter(e => e.pipeline_id === pid).map(e => e.label),
      soloLoSuyo: soloMios,
    });

    if (uso) {
      await registrarUso({ userId: await cuentaDe(userId), actorId: userId, origen: 'voz', modelo, uso }).catch(() => {});
    }
    return jsonResp({ ...resp, dijo: texto, intencion: plan.intencion });
  } catch (e) {
    console.error('[voz]', e?.message);
    return jsonResp({ error: 'No se pudo procesar. Reintenta en un momento.' }, 500);
  }
}

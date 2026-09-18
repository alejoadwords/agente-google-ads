// api/voz.js — hablarle al CRM.
//
// Recibe lo que alguien dijo en voz alta desde el teléfono y devuelve una
// tarjeta ya armada más una frase para leer en voz alta.
//
// EL MODELO NO INVENTA NÚMEROS. No ve la base ni escribe consultas: solo puede
// pedir las herramientas de `_voz-herramientas.js`, todas de solo lectura y
// todas con el alcance de quien pregunta ya aplicado. Cada cifra que sale por
// el altavoz salió de una de ellas. Un asistente que se equivoca sonando igual
// de seguro que cuando acierta es peor que no tenerlo.
//
// Antes esto era un catálogo cerrado de doce intenciones y todo lo que no
// estuviera en la lista caía en «no entendí» — pero quien habla no conoce la
// lista. Ahora el modelo pregunta lo que necesite y compone la respuesta.
//
// Fase 1: solo CONSULTA. Pedir crear, mover o mandar algo se responde con un
// «todavía no», nunca intentándolo.

export const config = { runtime: 'edge' };

import { quienPregunta, soloSusLeads } from './_perfiles.js';
import { registrarUso, cuentaDe, costoDe } from './_uso-ia.js';
import { HERRAMIENTAS, ejecutar, hoyLocal } from './_voz-herramientas.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TZ = 'America/Bogota';
const MAX_VUELTAS = 6;          // tope de idas y venidas con las herramientas

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

// Quién la tiene encendida. En una variable de entorno para sumar gente sin
// desplegar.
function enLaBeta(id) {
  return String(process.env.VOZ_BETA || '').split(',').map(s => s.trim()).filter(Boolean).includes(id);
}

const INSTRUCCIONES = `Eres el asistente de voz de Acuarius, un CRM. Alguien te acaba de HABLAR desde su teléfono, probablemente mientras hace otra cosa. Le respondes con datos reales de su cuenta.

CÓMO TRABAJAS
- Usa las herramientas para averiguar lo que haga falta. Si necesitas dos cosas y no dependen una de otra, PÍDELAS EN LA MISMA VUELTA: cada vuelta le hace esperar unos segundos más a alguien que está manejando.
- NUNCA des una cifra, un nombre, una fecha o un importe que no haya salido de una herramienta. Si no lo sabes, dilo.
- Si una herramienta devuelve "varios", pregúntale a cuál se refiere en vez de escoger tú.
- Si la pregunta es amplia o no sabes por dónde empezar, llama a "panorama" primero.

QUÉ NO PUEDES HACER
Esta versión solo consulta. Si te piden crear una tarea, mover un lead de etapa, asignar, borrar o mandar un mensaje, dilo con naturalidad: que por ahora solo puedes consultar y que eso llegará. No lo intentes ni digas que lo hiciste.

CÓMO RESPONDES
Cuando tengas la respuesta, llama a la herramienta "responder". ES LA ÚNICA FORMA de contestarle: nada de lo que escribas fuera de ella se le muestra a nadie. Llámala una sola vez y al final.

CÓMO HABLAS
- Español de Colombia, tuteo, sin jerga técnica. Nunca digas "según los datos", "el sistema" ni "la base de datos".
- "voz" se ESCUCHA: nada de listas ni de leer quince nombres seguidos. El detalle va en "filas", que se ve en pantalla.
- Importes en pesos, con puntos de miles y sin decimales.
- Si un número necesita una salvedad para no engañar —cerrados sin fecha, actividad sin autor— ponla en "nota_al_pie". No la escondas.
- "escalera" solo cuando hables de la etapa de un lead concreto.
- "acciones" útiles y pocas: "Abrir su ficha", "Llamarlo", "Abrir la agenda", "Ver el tablero".`;

async function conversar(texto, ctx, apiKey) {
  const mensajes = [{ role: 'user', content: texto }];
  const usadas = [];              // qué consultó, en orden: sirve para el estudio
  const usoTotal = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  let modelo = null;

  for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 2000,
        // Lo que NO cambia —instrucciones y esquemas, unos 1.900 tokens— se
        // marca para caché. El ahorro es modesto (≈9% de la consulta) porque
        // el grueso de la entrada son los resultados de las herramientas, que
        // cambian siempre; pero dentro de una misma consulta hay dos o tres
        // llamadas y la segunda ya lee de caché en vez de pagar el precio
        // entero. Lo variable va DESPUÉS del marcador, o invalidaría el caché
        // en cada consulta.
        system: [
          { type: 'text', text: INSTRUCCIONES, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: `HOY ES ${ctx.hoy} (${ctx.diaSemana}). Quien te habla es ${ctx.nombre}` +
              (ctx.soloLoSuyo ? ', y su perfil solo ve los leads a su nombre.' : ', y ve toda la cuenta.') },
        ],
        tools: HERRAMIENTAS,
        messages: mensajes,
      }),
    });
    if (!r.ok) throw new Error('anthropic ' + r.status + ' ' + (await r.text()).slice(0, 200));
    const d = await r.json();
    modelo = d.model;
    if (d.usage) {
      usoTotal.input_tokens += d.usage.input_tokens || 0;
      usoTotal.output_tokens += d.usage.output_tokens || 0;
      usoTotal.cache_creation_input_tokens += d.usage.cache_creation_input_tokens || 0;
      usoTotal.cache_read_input_tokens += d.usage.cache_read_input_tokens || 0;
    }

    const pedidos = (d.content || []).filter(c => c.type === 'tool_use');

    // La respuesta llega como herramienta, no como texto que haya que parsear.
    // Antes el JSON venía dentro del texto y yo lo sacaba buscando la ÚLTIMA
    // llave: con `filas` —que es una lista de objetos— esa llave era la de una
    // fila, se parseaba ese trozo suelto y la respuesta entera se perdía.
    // Fallaba toda pregunta cuya respuesta tuviera detalle, que son casi todas.
    const respuesta = pedidos.find(p => p.name === 'responder');
    if (respuesta) return { card: respuesta.input, uso: usoTotal, modelo, usadas, vueltas: vuelta + 1 };

    if (!pedidos.length || d.stop_reason !== 'tool_use') {
      const txt = (d.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
      return { card: txt ? { voz: txt, etiqueta: 'Respuesta' } : null, uso: usoTotal, modelo, usadas, vueltas: vuelta + 1 };
    }

    mensajes.push({ role: 'assistant', content: d.content });
    const resultados = [];
    for (const p of pedidos) {
      usadas.push(p.name);
      let salida;
      try { salida = await ejecutar(p.name, p.input, ctx); }
      catch (e) { salida = { error: 'No se pudo consultar: ' + (e && e.message ? e.message : 'fallo') }; }
      resultados.push({ type: 'tool_result', tool_use_id: p.id, content: JSON.stringify(salida).slice(0, 6000) });
    }
    mensajes.push({ role: 'user', content: resultados });
  }
  return { card: null, uso: usoTotal, modelo, usadas, vueltas: MAX_VUELTAS };
}

// Apuntar la pregunta no puede costarle un segundo a quien espera la
// respuesta, ni tumbarla si falla: va suelta y con el fallo a la consola.
function apuntarPregunta(fila) {
  fetch(`${SUPABASE_URL}/rest/v1/voz_consultas`, {
    method: 'POST',
    headers: { ...sbHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify(fila),
  }).catch(e => console.error('[voz] no se pudo apuntar la pregunta:', e && e.message));
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);
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
    // Toda la cuenta, no el cliente que tenga abierto: quien habla no está
    // mirando la pantalla y no tiene por qué haber elegido el tablero antes.
    const [leadsRaw, etapasRaw, tablerosRaw, equipoRaw] = await Promise.all([
      sb(`/leads?user_id=eq.${quien.userId}&deleted_at=is.null${filtroMios}` +
         `&select=id,name,stage,pipeline_id,assigned_to,value,source,tags,created_at,updated_at,closed_at` +
         `&order=updated_at.desc&limit=600`),
      sb(`/pipeline_stages?user_id=eq.${quien.userId}&select=key,label,pipeline_id&order=position.asc`),
      sb(`/pipelines?user_id=eq.${quien.userId}&select=id,name`),
      soloMios ? Promise.resolve([])
               : sb(`/team_members?owner_user_id=eq.${quien.userId}&status=eq.active` +
                    `&member_user_id=not.is.null&select=member_user_id,member_name,member_email`),
    ]);

    // Cada etapa se traduce con SU tablero: dos tableros pueden usar la misma
    // clave con rótulos distintos («ganado» es «Entrega de inmueble» en uno y
    // «Firma de promesa» en otro).
    const rotulo = {}; etapasRaw.forEach(e => { rotulo[(e.pipeline_id || '') + '|' + e.key] = e.label; });
    const nombreTablero = {}; tablerosRaw.forEach(t => { nombreTablero[t.id] = t.name; });

    const leads = leadsRaw.map(l => ({
      ...l,
      etiquetaEtapa: rotulo[(l.pipeline_id || '') + '|' + l.stage] || l.stage,
      tablero: nombreTablero[l.pipeline_id] || null,
    }));
    const equipo = (equipoRaw || []).map(m => ({ id: m.member_user_id, nombre: m.member_name || m.member_email }));

    const ctx = {
      userId: quien.userId, actorId: quien.actorId,
      soloLoSuyo: soloMios, esDueno: quien.esDueno === true, veElEquipo: !soloMios,
      leads, equipo,
      hoy: hoyLocal(),
      diaSemana: new Intl.DateTimeFormat('es-CO', { timeZone: TZ, weekday: 'long' }).format(new Date()),
      nombre: quien.nombre || 'el dueño de la cuenta',
    };

    const arranco = Date.now();
    const { card, uso, modelo, usadas, vueltas } = await conversar(texto, ctx, apiKey);
    const ms = Date.now() - arranco;

    if (uso && (uso.input_tokens || uso.output_tokens)) {
      await registrarUso({ userId: await cuentaDe(userId), actorId: userId, origen: 'voz', modelo, uso }).catch(() => {});
    }
    // Se guarda QUÉ se preguntó, para saber si un enrutador gratis puede
    // atender lo frecuente sin llamar al modelo. Hoy no lo sabemos: `ai_usage`
    // mide el gasto, no las preguntas, y elegir qué frases programar a ciegas
    // sería adivinar. Estudio temporal, solo de quien está en la beta.
    apuntarPregunta({
      user_id: quien.userId, actor_id: quien.actorId, texto,
      herramientas: usadas, vueltas, ms,
      etiqueta: card && card.etiqueta ? String(card.etiqueta).slice(0, 40) : null,
      respondio: !!(card && card.voz),
      tokens_in: uso.input_tokens, tokens_out: uso.output_tokens,
      cache_write: uso.cache_creation_input_tokens, cache_read: uso.cache_read_input_tokens,
      costo: costoDe(modelo, uso),
    });

    if (!card || !card.voz) {
      return jsonResp({
        etiqueta: 'No entendí',
        voz: 'No conseguí armar la respuesta. ¿Me lo preguntas de otra forma?',
        dijo: texto,
      });
    }
    return jsonResp({ ...card, dijo: texto });
  } catch (e) {
    console.error('[voz]', e && e.message);
    return jsonResp({ error: 'No se pudo procesar. Reintenta en un momento.' }, 500);
  }
}

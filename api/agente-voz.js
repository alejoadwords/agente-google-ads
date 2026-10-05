// api/agente-voz.js — el agente de voz: lo que pide el worker y lo que ve el cliente.
//
// Dos públicos en un mismo endpoint:
//
//   EL WORKER (voz-agente/, fuera de Vercel), con la cabecera x-agente-voz:
//     POST { accion: 'config', sala, numero | agente_id, telefono, direccion }
//          → quién es el agente, sus instrucciones, el saludo y cuánto puede durar.
//            Abre la fila de la llamada en llamadas_voz.
//     POST { accion: 'herramienta', llamada_id, nombre, args } → ejecuta una herramienta.
//     POST { accion: 'fin', llamada_id, segundos, transcripcion, uso, estado }
//          → cierra la llamada, la cobra por minuto o fracción y la deja en la ficha.
//
//   EL CLIENTE, con su sesión:
//     GET                                → { activo, planes, saldo, agentes, llamadas }
//     POST { accion: 'guardar', agente } → crea o edita su agente
//     POST { accion: 'probar', agente_id } → token para hablar con el agente desde el navegador
//
// Todo lo que decide (precios, redondeo, instrucciones) vive en _agente-voz.js.

export const config = { runtime: 'edge' };

import { verificarSesion, cuerpoSinSesion } from './_sesion.js';
import { quienPregunta, alcanceDeCliente } from './_perfiles.js';
import {
  agenteVozActivo, PLANES_VOZ, USD_MINUTO_EXTRA, PROPOSITOS, VELOCIDADES, VELOCIDAD_DEFECTO, minutosCobrados, costoEstimado, normalizarNumero,
  saldoMinutos, cobrarLlamada, esElWorker, tokenLiveKit, NOMBRE_WORKER, instruccionesDeVoz, saludoDe, bloqueCitasVoz,
  HERRAMIENTAS_SERVIDOR, HERRAMIENTAS, proximosDias,
} from './_agente-voz.js';
import { bloqueDeAhora, tratamiento, propiedadesParaPrompt, aPlata } from './_inbox-engine.js';
import { reservasParaAgente, ejecutarReserva } from './_reservas-agente.js';
import { intakeLead } from './_lead-intake.js';
import { registrarError } from './_registro-errores.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-agente-voz',
};
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

// Una llamada de prueba desde el navegador dura como mucho esto y no se cobra.
const MAX_SEGUNDOS_PRUEBA = 300;
// Tope de una llamada de verdad, aunque haya saldo para más: una llamada que se
// queda abierta (alguien deja el teléfono descolgado) no puede gastar la cuenta.
const MAX_SEGUNDOS_LLAMADA = 30 * 60;

async function sb(ruta, init = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, {
    ...init, headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, ...(init.headers || {}) },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

const filtroCliente = (c) => (c ? `client_id=eq.${encodeURIComponent(c)}` : 'client_id=is.null');

/** El lead de la cuenta con ese teléfono (comparando los 10 últimos dígitos), o null. */
async function leadDelTelefono(userId, clientId, telefono) {
  const d = String(telefono || '').replace(/\D/g, '');
  if (d.length < 7) return null;
  const filas = await sb(`/leads?user_id=eq.${encodeURIComponent(userId)}&${filtroCliente(clientId)}&deleted_at=is.null` +
    `&phone=like.*${d.slice(-4)}&select=id,name,email,stage,phone&order=created_at.desc&limit=1000`);
  return (filas || []).find(l => String(l.phone || '').replace(/\D/g, '').endsWith(d.slice(-10))) || null;
}

// ── El worker ───────────────────────────────────────────────────────────────
async function workerConfig(b) {
  const sala = String(b.sala || '').slice(0, 120);
  if (!sala) return json({ error: 'falta la sala' }, 400);
  const prueba = b.direccion === 'prueba';
  let agente = null;
  if (b.agente_id) {
    [agente] = await sb(`/agentes_voz?id=eq.${encodeURIComponent(b.agente_id)}&select=*`);
  } else {
    const numero = normalizarNumero(b.numero);
    if (numero) [agente] = await sb(`/agentes_voz?numero=eq.${numero}&select=*`);
  }
  if (!agente) return json({ error: 'No hay un agente para este número', colgar: true }, 404);
  if (!agente.activo || !agenteVozActivo(agente.user_id)) {
    return json({ error: 'El agente está apagado', colgar: true, desvio: agente.desvio || null }, 409);
  }

  // Si la sala ya tiene su fila (el worker se reinició a mitad), se reusa.
  let [llamada] = await sb(`/llamadas_voz?sala=eq.${encodeURIComponent(sala)}&select=*`);
  const telefono = prueba ? null : normalizarNumero(b.telefono);
  const lead = prueba ? null : await leadDelTelefono(agente.user_id, agente.client_id, telefono);

  let maxSegundos = MAX_SEGUNDOS_PRUEBA;
  if (!prueba) {
    const saldo = await saldoMinutos(agente.user_id);
    if (saldo <= 0) {
      // Sin minutos no se cuelga a nadie: la llamada pasa al asesor. Que el
      // cliente lo vea en su historial, para que sepa por qué.
      if (!llamada) {
        [llamada] = await sb('/llamadas_voz', { method: 'POST', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ user_id: agente.user_id, client_id: agente.client_id, agente_id: agente.id, lead_id: lead?.id || null,
            sala, direccion: 'entrante', telefono, estado: 'sin_saldo', fin: new Date().toISOString(), segundos: 0, minutos_cobrados: 0 }) });
      }
      return json({ sin_saldo: true, llamada_id: llamada.id, desvio: agente.desvio || null,
        mensaje: 'En este momento te comunico con un asesor.' });
    }
    maxSegundos = Math.min(MAX_SEGUNDOS_LLAMADA, saldo * 60);
  }

  if (!llamada) {
    [llamada] = await sb('/llamadas_voz', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ user_id: agente.user_id, client_id: agente.client_id, agente_id: agente.id, lead_id: lead?.id || null,
        sala, direccion: prueba ? 'prueba' : 'entrante', telefono }) });
  }

  // Lo que el agente necesita saber del negocio. Si algo de esto falla, la
  // llamada sigue sin eso: un catálogo caído no puede dejar sin contestar.
  const negocio = agente.negocio || agente.nombre;
  let hayCatalogo = false, citas = '';
  try { hayCatalogo = (await propiedadesParaPrompt(agente.user_id, agente.client_id, {})).total > 0; }
  catch (e) { console.error('[agente-voz] catálogo:', e.message); }
  try { citas = bloqueCitasVoz(await reservasParaAgente(agente.user_id, agente.client_id)); }
  catch (e) { console.error('[agente-voz] reservas:', e.message); }
  const conocido = lead ? [lead.name, lead.email].filter(Boolean).join(', ') : null;
  const primerNombre = lead?.name && lead.name !== 'Lead sin nombre' ? lead.name.split(' ')[0] : null;

  return json({
    llamada_id: llamada.id,
    agente: { id: agente.id, nombre: agente.nombre, voz: agente.voz || null, proposito: agente.proposito, velocidad: Number(agente.velocidad) || VELOCIDAD_DEFECTO },
    instrucciones: instruccionesDeVoz({
      agente, negocio, conocido, hayCatalogo, citas,
      ahora: bloqueDeAhora('America/Bogota') + '\n' + proximosDias(),
      tratamiento: tratamiento(agente.tono === 'formal' ? 'formal' : 'tu'),
    }),
    saludo: saludoDe(agente, negocio, primerNombre),
    desvio: agente.desvio || null,
    max_segundos: maxSegundos,
    herramientas: HERRAMIENTAS,
  });
}

async function workerHerramienta(b) {
  const [llamada] = await sb(`/llamadas_voz?id=eq.${encodeURIComponent(b.llamada_id)}&select=*`);
  if (!llamada) return json({ error: 'llamada desconocida' }, 404);
  const [agente] = llamada.agente_id ? await sb(`/agentes_voz?id=eq.${llamada.agente_id}&select=*`) : [null];
  const prueba = llamada.direccion === 'prueba';
  const a = b.args && typeof b.args === 'object' ? b.args : {};
  const { user_id: userId, client_id: clientId } = llamada;

  switch (b.nombre) {
    case 'guardar_datos': {
      // En una prueba desde el navegador no se crea nada: no hay teléfono y
      // llenaría el CRM de leads de ensayo.
      if (prueba) return json({ ok: true, prueba: true, texto: 'Datos anotados (llamada de prueba: no se guardan en el CRM).' });
      const { lead } = await intakeLead(userId, clientId, {
        name: String(a.nombre || '').slice(0, 120) || undefined,
        email: correoLimpio(a.correo) || undefined,
        phone: llamada.telefono || undefined,
        note: a.interes ? String(a.interes).slice(0, 500) : undefined,
        source: 'agente_de_voz', sourceLabel: 'Agente de voz',
      });
      if (lead?.id && lead.id !== llamada.lead_id) {
        await sb(`/llamadas_voz?id=eq.${llamada.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ lead_id: lead.id }) });
      }
      return json({ ok: true, texto: 'Datos guardados en el CRM.' });
    }
    case 'buscar_inmuebles': {
      // Las pistas como las entiende la búsqueda del agente de WhatsApp. En la
      // primera prueba con Certain (05-10-2026) el presupuesto llegaba como
      // texto («3 millones»): el filtro quedaba en «lte.NaN», la consulta
      // fallaba en silencio y Aura dijo que no había nada, con 8 opciones en
      // el catálogo. Y la zona iba en un campo que la búsqueda no lee, así que
      // «el norte» nunca se traducía a sus barrios.
      // Los criterios se acumulan durante la llamada: si en la segunda
      // búsqueda el modelo olvida uno que ya mandó (pasó con las
      // habitaciones), se conserva el anterior.
      const pistas = combinarBusqueda(llamada.busqueda, buscarPistas(a));
      // Y lo que el modelo no mandó pero la persona sí dijo, leído de la
      // conversación por código. Haiku olvidaba las habitaciones en uno de
      // cada dos ensayos aunque el campo fuera obligatorio.
      if (!pistas.habitaciones) {
        const h = habitacionesDeLaConversacion(b.contexto);
        if (h) pistas.habitaciones = h;
      }
      // Se espera: en una función edge, lo que no se espera puede quedar
      // cortado al responder. Si falla, la búsqueda sigue igual.
      try { await sb(`/llamadas_voz?id=eq.${llamada.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ busqueda: pistas }) }); }
      catch (e) { console.error('[agente-voz] no se guardó la búsqueda:', e.message); }
      const r = await propiedadesParaPrompt(userId, clientId, pistas);
      const lineas = (r.lineas || []).slice(0, 4);
      if (!lineas.length) return json({ ok: true, total: 0, texto: 'No hay inmuebles que cumplan eso en el catálogo. Ofrece que un asesor busque otras opciones.' });
      const aviso = r.ampliado ? `No hay en ${pistas.barrio}; estas son de otras zonas:\n` : '';
      // El total, dicho: con solo las cuatro primeras el modelo creía que eran
      // todas («en el norte con tu presupuesto tengo esa opción», con decenas).
      const cuantas = (r.total || 0) > lineas.length
        ? `Hay ${r.total} opciones; estas son las ${lineas.length} más económicas. Si la persona precisa algo (habitaciones, barrio, precio), vuelve a buscar con eso:\n`
        : `Hay ${lineas.length} ${lineas.length === 1 ? 'opción' : 'opciones'}:\n`;
      return json({ ok: true, total: r.total || 0, texto: aviso + cuantas + lineas.join('\n') });
    }
    case 'agendar_cita': {
      const info = await reservasParaAgente(userId, clientId);
      if (!info) return json({ ok: false, texto: 'Este negocio no tiene citas para agendar por teléfono. Ofrece que lo llame un asesor.' });
      const r = await ejecutarReserva({
        info, simular: prueba, leadId: llamada.lead_id,
        pedido: { servicio: a.servicio, dia: a.dia, hora: a.hora, nombre: a.nombre, con: a.con || '' },
        contacto: { telefono: llamada.telefono || (prueba ? 'prueba' : null), nombre: a.nombre || null },
      });
      return json({ ok: !!r.ok, texto: r.texto || (r.ok ? 'Cita agendada.' : 'No se pudo agendar.') });
    }
    case 'pasar_a_asesor': {
      if (!prueba && llamada.lead_id) {
        await sb('/lead_activities', { method: 'POST', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ lead_id: llamada.lead_id, user_id: userId, type: 'nota',
            content: 'Pidió hablar con un asesor durante la llamada con el agente de voz' + (a.motivo ? ': ' + String(a.motivo).slice(0, 300) : '.'),
            metadata: { agente_voz: true, llamada_id: llamada.id } }) });
      }
      return json({ ok: true, desvio: agente?.desvio || null,
        texto: agente?.desvio ? 'Te comunico con un asesor.' : 'No hay un número de asesor configurado: ofrece que lo llamen y guarda sus datos.' });
    }
    default:
      return json({ error: 'herramienta desconocida: ' + b.nombre }, 400);
  }
}

async function resumenDeLlamada(transcripcion) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !transcripcion.length) return null;
  const texto = transcripcion.map(t => (t.rol === 'agente' ? 'Agente: ' : 'Cliente: ') + t.texto).join('\n').slice(0, 12000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 300,
        messages: [{ role: 'user', content: 'Resume esta llamada para el asesor en 2 o 3 frases: qué buscaba la persona, qué se acordó y el siguiente paso. Sin saludos.\n\n' + texto }] }),
    });
    if (!r.ok) return null;
    return (await r.json()).content?.[0]?.text?.trim() || null;
  } catch { return null; }
}

async function workerFin(b) {
  const [llamada] = await sb(`/llamadas_voz?id=eq.${encodeURIComponent(b.llamada_id)}&select=*`);
  if (!llamada) return json({ error: 'llamada desconocida' }, 404);
  if (llamada.fin && llamada.estado !== 'en_curso') return json({ ok: true, repetida: true, minutos: llamada.minutos_cobrados });

  const segundos = Math.max(0, Math.round(Number(b.segundos) || 0));
  const prueba = llamada.direccion === 'prueba';
  const minutos = prueba ? 0 : minutosCobrados(segundos);
  const transcripcion = (Array.isArray(b.transcripcion) ? b.transcripcion : [])
    .filter(t => t && t.texto).slice(0, 400)
    .map(t => ({ rol: t.rol === 'agente' ? 'agente' : 'cliente', texto: String(t.texto).slice(0, 2000) }));
  const estado = ['terminada', 'desviada', 'error'].includes(b.estado) ? b.estado : 'terminada';
  const resumen = await resumenDeLlamada(transcripcion);

  await sb(`/llamadas_voz?id=eq.${llamada.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ fin: new Date().toISOString(), segundos, minutos_cobrados: minutos, estado, transcripcion, resumen,
      uso: b.uso && typeof b.uso === 'object' ? b.uso : null, costo_usd: costoEstimado(segundos) }) });
  // Cobrar va DESPUÉS de cerrar la fila y con la llamada como referencia: si el
  // worker manda el fin dos veces, el libro no descuenta dos veces.
  if (minutos) await cobrarLlamada(llamada.user_id, llamada.id, minutos, { segundos });

  if (!prueba && llamada.lead_id) {
    const m = Math.floor(segundos / 60), s = segundos % 60;
    await sb('/lead_activities', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ lead_id: llamada.lead_id, user_id: llamada.user_id, type: 'llamada',
        content: `Llamada con el agente de voz (${m}:${String(s).padStart(2, '0')})` + (resumen ? ': ' + resumen : '.'),
        metadata: { agente_voz: true, llamada_id: llamada.id, estado } }) });
  }
  return json({ ok: true, minutos });
}

/**
 * El correo como se dictó por teléfono no siempre es un correo: el modelo lo
 * escribía «Alejandro.González@Gmail.com». Sin tildes, sin espacios, en
 * minúsculas; y si no tiene forma de correo, no se guarda.
 */
export function correoLimpio(c) {
  const t = String(c || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '').toLowerCase().slice(0, 160);
  return /^[^@]+@[^@]+\.[a-z]{2,}$/.test(t) ? t : '';
}

const NUMEROS = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8 };
const numeroDe = (t) => {
  const m = String(t || '').toLowerCase().match(/\b(\d{1,2}|una?|uno|dos|tres|cuatro|cinco|seis|siete|ocho)\b/);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMEROS[m[1]];
  return n >= 1 && n <= 8 ? n : null;
};
const HABITACION = /\b(habitaci[oó]n|habitaciones|alcobas?|cuartos?|dormitorios?|piezas?)\b/i;

/**
 * Las habitaciones que dijo la persona, leídas de la conversación (como llega
 * por teléfono: en palabras). Vale «tres habitaciones» dicho de una vez, y un
 * número dicho justo después de que el agente preguntara por habitaciones
 * («¿cuántas habitaciones?» → «mínimo dos»). Se mira de lo último a lo
 * primero: si cambió de idea, vale lo último que dijo.
 */
export function habitacionesDeLaConversacion(contexto = []) {
  const c = Array.isArray(contexto) ? contexto.filter(t => t && t.texto) : [];
  for (let i = c.length - 1; i >= 0; i--) {
    if (c[i].rol !== 'cliente') continue;
    const t = String(c[i].texto);
    const junto = t.match(/\b(\d{1,2}|una?|uno|dos|tres|cuatro|cinco|seis|siete|ocho)\s+(habitaci[oó]n|habitaciones|alcobas?|cuartos?|dormitorios?|piezas?)\b/i);
    if (junto) return numeroDe(junto[1]);
    const antes = c.slice(0, i).reverse().find(x => x.rol === 'agente');
    if (antes && HABITACION.test(antes.texto) && /\?/.test(antes.texto)) {
      const n = numeroDe(t);
      if (n) return n;
    }
  }
  return null;
}

/** Lo nuevo manda; lo que no vino se toma de la búsqueda anterior. */
export function combinarBusqueda(antes, ahora) {
  const out = { ...(antes && typeof antes === 'object' ? antes : {}) };
  for (const [k, v] of Object.entries(ahora || {})) if (v !== undefined && v !== null && v !== '') out[k] = v;
  return out;
}

/**
 * Lo que dijo el modelo, como lo espera propiedadesParaPrompt: el presupuesto
 * en pesos (número), la zona en `barrio` (es el campo que traduce «el norte»
 * a los barrios del catálogo) y el tipo con la mayúscula del catálogo.
 */
export function buscarPistas(a = {}) {
  const presupuesto = typeof a.presupuesto === 'number' ? a.presupuesto : aPlata(a.presupuesto);
  const tipo = String(a.tipo || '').trim().toLowerCase();
  const habitaciones = Math.round(Number(a.habitaciones)) || 0;
  return {
    operacion: a.operacion || undefined,
    ciudad: a.ciudad || undefined,
    barrio: (a.zona || a.barrio || '').trim() || undefined,
    presupuesto: presupuesto > 0 ? presupuesto : undefined,
    habitaciones: habitaciones > 0 ? habitaciones : undefined,
    tipo: tipo ? tipo.charAt(0).toUpperCase() + tipo.slice(1) : undefined,
  };
}

// ── Ensayo en texto ─────────────────────────────────────────────────────────
// La conversación de una llamada, sin audio: el mismo modelo, las mismas
// instrucciones y las mismas herramientas (ejecutadas por workerHerramienta,
// en modo prueba: no crea leads ni cobra). Sirve para probar un cambio antes
// de que alguien tenga que llamar para descubrir que no funciona.
//
// Va por streaming: varias respuestas de Claude seguidas pasan de los 25 s
// en que una función edge tiene que empezar a responder.
const MODELO_VOZ = 'claude-haiku-4-5';

async function claude(cuerpo) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  const d = await r.json();
  if (!r.ok) throw new Error('Anthropic ' + r.status + ': ' + JSON.stringify(d).slice(0, 200));
  return d;
}

export async function ensayar({ agenteId, turnos, modelo = MODELO_VOZ, ejecutar = workerHerramienta, llm = claude, config = workerConfig }) {
  const sala = 'ensayo-' + crypto.randomUUID();
  const cfg = await (await config({ sala, agente_id: agenteId, direccion: 'prueba' })).json();
  if (!cfg.llamada_id) return { error: cfg.error || 'sin configuración' };
  const tools = (cfg.herramientas || HERRAMIENTAS).map(h => ({ name: h.nombre, description: h.descripcion, input_schema: h.parametros }));
  const mensajes = [{ role: 'user', content: '(entra la llamada)' }, { role: 'assistant', content: cfg.saludo }];
  const traza = [{ rol: 'agente', texto: cfg.saludo }];
  let colgo = false;
  const uso = { entrada: 0, salida: 0, cache: 0 };
  for (const turno of (turnos || []).slice(0, 12)) {
    if (colgo) break;
    mensajes.push({ role: 'user', content: String(turno) });
    traza.push({ rol: 'cliente', texto: String(turno) });
    for (let paso = 0; paso < 4; paso++) {
      const t0 = Date.now();
      const r = await llm({ model: modelo, max_tokens: 160, temperature: 0.6, system: cfg.instrucciones, tools, messages: mensajes });
      const ms = Date.now() - t0;
      uso.entrada += r.usage?.input_tokens || 0; uso.salida += r.usage?.output_tokens || 0;
      uso.cache += r.usage?.cache_read_input_tokens || 0;
      mensajes.push({ role: 'assistant', content: r.content });
      const texto = r.content.filter(c => c.type === 'text').map(c => c.text).join(' ').trim();
      if (texto) traza.push({ rol: 'agente', texto, ms });
      const usos = r.content.filter(c => c.type === 'tool_use');
      if (!usos.length) break;
      const resultados = [];
      for (const u of usos) {
        let resultado;
        if (u.name === 'colgar') { colgo = true; resultado = 'Llamada terminada.'; }
        else {
          const contexto = traza.filter(t => t.rol).slice(-10).map(t => ({ rol: t.rol, texto: t.texto }));
          const d = await (await ejecutar({ llamada_id: cfg.llamada_id, nombre: u.name, args: u.input, contexto })).json();
          resultado = d.texto || d.error || (d.ok ? 'Hecho.' : 'No se pudo.');
        }
        traza.push({ herramienta: u.name, args: u.input, resultado: String(resultado).slice(0, 600) });
        resultados.push({ type: 'tool_result', tool_use_id: u.id, content: String(resultado) });
      }
      mensajes.push({ role: 'user', content: resultados });
    }
  }
  return { llamada_id: cfg.llamada_id, modelo, traza, colgo, uso };
}

// ── El cliente ──────────────────────────────────────────────────────────────
function validarAgente(a) {
  const out = {
    nombre: String(a.nombre || '').trim().slice(0, 40),
    negocio: String(a.negocio || '').trim().slice(0, 80),
    proposito: PROPOSITOS.includes(a.proposito) ? a.proposito : 'recepcion',
    saludo: String(a.saludo || '').trim().slice(0, 300) || null,
    instrucciones: String(a.instrucciones || '').trim().slice(0, 4000) || null,
    voz: String(a.voz || '').trim().slice(0, 80) || null,
    tono: a.tono === 'formal' ? 'formal' : 'tu',
    velocidad: Object.values(VELOCIDADES).includes(Number(a.velocidad)) ? Number(a.velocidad) : VELOCIDAD_DEFECTO,
    desvio: a.desvio ? normalizarNumero(a.desvio) : null,
    activo: a.activo !== false,
  };
  if (!out.nombre) return { error: 'Ponle un nombre al agente (es como se presenta al contestar).' };
  if (!out.negocio) return { error: 'Escribe el nombre del negocio: el agente lo dice al contestar.' };
  if (a.desvio && !out.desvio) return { error: 'El número del asesor no parece un teléfono válido.' };
  return { agente: out };
}

async function cliente(req, sesion) {
  let quien;
  try { quien = await quienPregunta(sesion.id); }
  catch { return json({ error: 'No se pudo comprobar tu acceso. Intenta de nuevo en un momento.' }, 503); }
  const cuenta = quien.userId;
  const clientId = alcanceDeCliente(quien, new URL(req.url).searchParams.get('client_id'));
  if (!agenteVozActivo(cuenta)) return json({ activo: false });
  const c = encodeURIComponent(cuenta);

  if (req.method === 'GET') {
    const [saldo, agentes, llamadas] = await Promise.all([
      saldoMinutos(cuenta),
      sb(`/agentes_voz?user_id=eq.${c}&${filtroCliente(clientId)}&select=*&order=created_at.asc`),
      sb(`/llamadas_voz?user_id=eq.${c}&${filtroCliente(clientId)}&select=id,agente_id,lead_id,direccion,telefono,estado,inicio,segundos,minutos_cobrados,resumen,transcripcion&order=inicio.desc&limit=50`),
    ]);
    return json({ activo: true, planes: PLANES_VOZ, usd_minuto_extra: USD_MINUTO_EXTRA, saldo, agentes, llamadas,
      livekit: !!(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET) });
  }

  let b;
  try { b = await req.json(); } catch { return json({ error: 'Body inválido' }, 400); }

  if (b.accion === 'guardar') {
    const v = validarAgente(b.agente || {});
    if (v.error) return json({ error: v.error }, 400);
    const ahora = new Date().toISOString();
    if (b.agente?.id) {
      const filas = await sb(`/agentes_voz?id=eq.${encodeURIComponent(b.agente.id)}&user_id=eq.${c}&${filtroCliente(clientId)}`,
        { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...v.agente, updated_at: ahora }) });
      if (!filas?.length) return json({ error: 'No encontré ese agente en tu cuenta.' }, 404);
      return json({ agente: filas[0] });
    }
    const [nuevo] = await sb('/agentes_voz', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ ...v.agente, user_id: cuenta, client_id: clientId }) });
    return json({ agente: nuevo });
  }

  if (b.accion === 'probar') {
    const [agente] = await sb(`/agentes_voz?id=eq.${encodeURIComponent(b.agente_id)}&user_id=eq.${c}&select=id,nombre`);
    if (!agente) return json({ error: 'No encontré ese agente en tu cuenta.' }, 404);
    if (!process.env.LIVEKIT_URL) return json({ error: 'El servicio de voz todavía no está conectado (falta LIVEKIT_URL).' }, 503);
    const sala = 'prueba-' + crypto.randomUUID();
    const token = await tokenLiveKit({
      identidad: 'cliente-' + cuenta.slice(-8), nombre: 'Prueba', sala, agente: NOMBRE_WORKER,
      metadata: JSON.stringify({ agente_id: agente.id, direccion: 'prueba' }), segundos: MAX_SEGUNDOS_PRUEBA + 60,
    });
    return json({ url: process.env.LIVEKIT_URL, token, sala, max_segundos: MAX_SEGUNDOS_PRUEBA });
  }

  return json({ error: 'Acción desconocida' }, 400);
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  try {
    if (req.headers.get('x-agente-voz')) {
      if (!esElWorker(req)) return json({ error: 'El worker de voz no se identificó: revisa AGENTE_VOZ_SECRETO' }, 401);
      if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
      const b = await req.json();
      if (b.accion === 'config') return await workerConfig(b);
      if (b.accion === 'herramienta') return await workerHerramienta(b);
      if (b.accion === 'fin') return await workerFin(b);
      if (b.accion === 'ensayo') {
        // Respuesta en streaming: se abre ya y se cierra con el resultado.
        const { readable, writable } = new TransformStream();
        const w = writable.getWriter();
        const enc = new TextEncoder();
        w.write(enc.encode(' '));
        ensayar({ agenteId: b.agente_id, turnos: b.turnos, modelo: /^claude-[a-z0-9.-]+$/.test(b.modelo || '') ? b.modelo : MODELO_VOZ })
          .then(r => w.write(enc.encode(JSON.stringify(r))))
          .catch(e => w.write(enc.encode(JSON.stringify({ error: String(e.message || e) }))))
          .finally(() => w.close());
        return new Response(readable, { headers: { 'Content-Type': 'application/json', ...CORS } });
      }
      return json({ error: 'Acción desconocida' }, 400);
    }
    if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
    const sesion = await verificarSesion(req);
    if (!sesion.id) return json(await cuerpoSinSesion(sesion, 'agente-voz'), 401);
    return await cliente(req, sesion);
  } catch (e) {
    await registrarError({ origen: 'api', donde: 'agente-voz', error: e });
    return json({ error: 'Algo falló de nuestro lado. Intenta de nuevo en un momento.' }, 500);
  }
}

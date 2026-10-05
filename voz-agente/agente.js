// voz-agente/agente.js — el worker que contesta las llamadas del agente de voz.
//
// Corre FUERA de Vercel (Fly.io): una llamada es una conexión de minutos y las
// funciones de Vercel se cortan mucho antes. LiveKit le reparte las llamadas:
//   · las de teléfono, que entran por Telnyx → SIP;
//   · las pruebas desde el navegador (botón «Probar» del módulo).
//
// El cerebro de cada agente (quién es, qué sabe, qué puede hacer) lo da
// Acuarius en cada llamada (acuarius.js → api/agente-voz.js). Aquí solo está
// la parte de audio: oír (Deepgram), decidir el turno (VAD + detector),
// pensar (Claude Haiku) y hablar (Cartesia).
//
// Deepgram y Cartesia van por LiveKit Inference: la misma cuenta y la misma
// factura de LiveKit, sin cuentas ni claves aparte, y sin que el audio se
// guarde. Claude no está en LiveKit Inference: va con nuestra clave de Anthropic.
//
//   node agente.js dev     → desarrollo, contra LiveKit Cloud
//   node agente.js start   → producción

import { cli, defineAgent, llm, voice, inference, ServerOptions } from '@livekit/agents';
import * as anthropic from '@livekit/agents-plugin-anthropic';
import * as silero from '@livekit/agents-plugin-silero';
import { SipClient } from 'livekit-server-sdk';
import { BackgroundVoiceCancellation, TelephonyBackgroundVoiceCancellation } from '@livekit/noise-cancellation-node';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { crearCliente, datosDeLaLlamada, transcripcionDe, duracion, conCache, resumenLatencias } from './acuarius.js';

export const NOMBRE_WORKER = 'acuarius-voz';
const MODELO = process.env.AGENTE_VOZ_MODELO || 'claude-haiku-4-5';
const VOZ_DEFECTO = process.env.VOZ_CARTESIA_DEFECTO || '';

// La voz: Cartesia sonic-3 en español. Sin id de voz, Cartesia usa la suya por
// defecto, que no es latina: por eso VOZ_CARTESIA_DEFECTO es obligatoria en
// producción (se elige en LiveKit → Voices, filtrando por español).
const vozDe = (voz, velocidad = 1.1) => new inference.TTS({
  model: 'cartesia/sonic-3', language: 'es', ...(voz ? { voice: voz } : {}),
  // A velocidad normal sonaba lenta en la primera prueba. Cartesia la toma
  // como guía, no como multiplicador exacto, así que no suena acelerada.
  modelOptions: { speed: velocidad },
});

// Claude con la caché de las instrucciones (ver conCache en acuarius.js).
function claudeConCache() {
  const cliente = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0 });
  const crear = cliente.messages.create.bind(cliente.messages);
  cliente.messages.create = (params, opciones) => crear(conCache(params), opciones);
  return cliente;
}

// Las herramientas llegan de Acuarius en la configuración de cada llamada
// (HERRAMIENTAS en api/_agente-voz.js): una sola definición para el worker y
// para el ensayo en texto. Aquí solo se decide QUIÉN las ejecuta: colgar y el
// desvío son del worker; el resto, del servidor.
export function herramientas(defs, { acuarius, llamadaId, colgar, desviar }) {
  const usar = (nombre) => async (args) => {
    try {
      const r = await acuarius.herramienta(llamadaId, nombre, args);
      return r.texto || (r.ok ? 'Hecho.' : (r.error || 'No se pudo.'));
    } catch (e) {
      return 'No pude hacerlo ahora mismo por un problema técnico. Ofrece que lo llame un asesor.';
    }
  };
  const ejecutores = {
    colgar: async () => { setTimeout(() => { colgar('terminada').catch(() => {}); }, 2000); return 'Llamada terminada.'; },
    pasar_a_asesor: async (args) => {
      const respuesta = await usar('pasar_a_asesor')(args);
      // El desvío va después de que el agente diga la frase: unos segundos.
      setTimeout(() => { desviar().catch(() => {}); }, 2500);
      return respuesta;
    },
  };
  const out = {};
  for (const h of defs || []) {
    out[h.nombre] = llm.tool({
      description: h.descripcion,
      parameters: h.parametros || { type: 'object', properties: {} },
      execute: ejecutores[h.nombre] || usar(h.nombre),
    });
  }
  return out;
}

export default defineAgent({
  prewarm: async (proc) => {
    proc.userData.vad = await silero.VAD.load();
  },
  entry: async (ctx) => {
    await ctx.connect();
    const persona = await ctx.waitForParticipant();
    const desde = Date.now();
    const datos = datosDeLaLlamada({ atributos: persona.attributes || {}, metadata: ctx.job.metadata });
    const acuarius = crearCliente();

    const cfg = await acuarius.config({ sala: ctx.room.name, ...datos });
    const sip = new SipClient(process.env.LIVEKIT_URL, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
    const esTelefono = datos.direccion === 'entrante' && !!datos.telefono;

    let cerrada = false;
    let estado = 'terminada';
    let session = null;
    const metricas = [];
    const cerrar = async () => {
      if (cerrada || !cfg.llamada_id) return;
      cerrada = true;
      const items = session ? session.history.items : [];
      await acuarius.fin(cfg.llamada_id, {
        segundos: duracion(desde), estado, transcripcion: transcripcionDe(items),
        uso: { ...(session?.usage ? JSON.parse(JSON.stringify(session.usage)) : {}), latencias: resumenLatencias(metricas) },
      }).catch(e => console.error('[voz] no se pudo cerrar la llamada', cfg.llamada_id, e.message));
    };
    ctx.addShutdownCallback(cerrar);
    const colgar = async (como = 'terminada') => { estado = como; await cerrar(); await ctx.deleteRoom(); };
    const desviar = async () => {
      if (!esTelefono || !cfg.desvio) return;
      estado = 'desviada';
      await sip.transferSipParticipant(ctx.room.name, persona.identity, 'tel:+' + cfg.desvio);
    };

    // Agente apagado, sin número o sin minutos: no se deja a nadie hablando
    // solo. Si hay a quién pasarla, se pasa; si no, se dice y se cuelga.
    if (cfg.colgar || cfg.sin_saldo || !cfg.instrucciones) {
      session = new voice.AgentSession({ tts: vozDe(VOZ_DEFECTO) });
      await session.start({ agent: new voice.Agent({ instructions: 'Solo lees el mensaje.' }), room: ctx.room });
      const frase = cfg.mensaje || 'En este momento no podemos atenderte por aquí. Por favor intenta más tarde.';
      await session.say(frase, { allowInterruptions: false }).waitForPlayout();
      if (cfg.desvio) await desviar().catch(() => {});
      return colgar(cfg.desvio ? 'desviada' : 'terminada');
    }

    const agente = new voice.Agent({
      instructions: cfg.instrucciones,
      tools: herramientas(cfg.herramientas, { acuarius, llamadaId: cfg.llamada_id, colgar, desviar }),
    });
    session = new voice.AgentSession({
      vad: ctx.proc.userData.vad,
      stt: new inference.STT({ model: 'deepgram/nova-3', language: 'es' }),
      // Turnos cortos también por tamaño: 160 tokens son unas 100 palabras,
      // de sobra para dos frases y una herramienta, y cortan cualquier discurso.
      llm: new anthropic.LLM({ model: MODELO, temperature: 0.6, maxTokens: 160, client: claudeConCache() }),
      tts: vozDe(cfg.agente?.voz || VOZ_DEFECTO, cfg.agente?.velocidad || 1.1),
      // Que empiece a pensar Y a preparar la voz mientras la persona termina
      // de hablar: si al final dice otra cosa, se descarta. Es lo que más
      // acorta el silencio antes de cada respuesta.
      turnHandling: {
        // El detector de fin de turno por AUDIO, el modelo local (v1-mini):
        // corre en el servidor, sin costo por minuto, y entiende español. Es
        // lo que decide si la persona terminó de hablar o solo hizo una pausa.
        turnDetection: new inference.TurnDetector({ version: 'v1-mini' }),
        preemptiveGeneration: { enabled: true, preemptiveTts: true },
        // Cuánto esperar a que la persona termine. Con el tope por defecto
        // (2,5 s) uno de cada diez turnos se quedaba esperando 2,5 s antes de
        // responder (segunda prueba, 05-10). A 1,6 s como máximo responde
        // antes; si alguien hace una pausa larga y se le interrumpe, el
        // agente se calla en cuanto vuelve a hablar.
        endpointing: { minDelay: 300, maxDelay: 1600 },
      },
    });
    session.on('metrics_collected', (ev) => { if (ev?.metrics) metricas.push(ev.metrics); });
    // Filtro de ruido y de voces de fondo (LiveKit Cloud) antes de que el
    // audio llegue al oído y al detector de turnos. En la quinta prueba
    // (05-10-2026) una radio de fondo se transcribió como si la persona
    // hablara («Radioactiva…»). Por teléfono, el modelo afinado para llamadas.
    await session.start({ agent: agente, room: ctx.room, inputOptions: {
      noiseCancellation: esTelefono ? TelephonyBackgroundVoiceCancellation() : BackgroundVoiceCancellation(),
    } });
    session.say(cfg.saludo);

    // Tope de duración: lo que alcanza el saldo, o 30 min. Se avisa antes de cortar.
    const max = Math.max(30, Number(cfg.max_segundos) || 300);
    setTimeout(() => {
      if (cerrada) return;
      session.say('Se nos está acabando el tiempo de la llamada. Si necesitas algo más, te contacta un asesor. ¡Gracias!');
      setTimeout(() => { colgar('terminada').catch(() => {}); }, 8000);
    }, (max - 20) * 1000);
  },
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName: NOMBRE_WORKER }));
}

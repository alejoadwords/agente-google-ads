// voz-agente/acuarius.js — lo que el worker habla con Acuarius, sin nada de LiveKit.
//
// Va aparte para poder probarlo sin audio ni red (pruebas/agente-voz.mjs):
// leer de qué llamada se trata, pedir la configuración, ejecutar herramientas
// y cerrar la llamada. Todo pasa por api/agente-voz.js con el secreto del
// worker; el worker nunca toca la base.

export function crearCliente({ base = process.env.ACUARIUS_URL || 'https://app.acuarius.app', secreto = process.env.AGENTE_VOZ_SECRETO, fetchFn = fetch } = {}) {
  if (!secreto) throw new Error('Falta AGENTE_VOZ_SECRETO');
  const post = async (cuerpo, intentos = 2) => {
    let ultimo;
    for (let i = 0; i < intentos; i++) {
      try {
        const r = await fetchFn(base + '/api/agente-voz', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-agente-voz': secreto },
          body: JSON.stringify(cuerpo),
        });
        const d = await r.json().catch(() => ({}));
        // Un 4xx es una respuesta (agente apagado, sin número): no se reintenta.
        if (r.status < 500) return { status: r.status, ...d };
        ultimo = new Error(d.error || 'HTTP ' + r.status);
      } catch (e) { ultimo = e; }
    }
    throw ultimo;
  };
  return {
    config: (datos) => post({ accion: 'config', ...datos }),
    // El contexto (lo último de la conversación) deja que el servidor complete
    // por código lo que el modelo olvidó pasar, como las habitaciones.
    herramienta: (llamadaId, nombre, args, contexto) => post({ accion: 'herramienta', llamada_id: llamadaId, nombre, args, contexto }, 1),
    // El fin se reintenta más: si se pierde, la llamada no se cobra ni queda en la ficha.
    fin: (llamadaId, datos) => post({ accion: 'fin', llamada_id: llamadaId, ...datos }, 4),
  };
}

/**
 * ¿Qué llamada es esta? Una de teléfono trae el número marcado y el de quien
 * llama en los atributos SIP del participante; una prueba desde el navegador
 * trae el agente en la metadata con que se despachó el worker.
 */
export function datosDeLaLlamada({ atributos = {}, metadata = '' } = {}) {
  let meta = {};
  try { meta = metadata ? JSON.parse(metadata) : {}; } catch { meta = {}; }
  if (meta.agente_id) return { direccion: meta.direccion === 'prueba' ? 'prueba' : 'entrante', agente_id: meta.agente_id, telefono: null, numero: null };
  return {
    direccion: 'entrante',
    agente_id: null,
    numero: atributos['sip.trunkPhoneNumber'] || null,
    telefono: atributos['sip.phoneNumber'] || null,
  };
}

/** La conversación de LiveKit, como la guarda Acuarius: [{ rol, texto }]. */
export function transcripcionDe(items = []) {
  return items
    .filter(m => m && (m.role === 'user' || m.role === 'assistant'))
    .map(m => ({ rol: m.role === 'assistant' ? 'agente' : 'cliente', texto: String(m.textContent ?? '').trim() }))
    .filter(t => t.texto);
}

/** Segundos entre dos instantes, redondeado. Nunca negativo. */
export function duracion(desdeMs, hastaMs = Date.now()) {
  return Math.max(0, Math.round((hastaMs - desdeMs) / 1000));
}

/**
 * Las instrucciones del agente son las mismas en todos los turnos de una
 * llamada; solo cambia la conversación. Marcarlas como caché hace que Claude
 * no las vuelva a leer en cada turno: responde antes y cuesta menos. En la
 * primera prueba (05-10-2026) se mandaron 51 mil tokens en 2,5 minutos sin
 * caché. El plugin de Anthropic de LiveKit no lo hace solo, así que se le
 * pasa un cliente que lo añade. Las herramientas van delante del sistema, así
 * que quedan dentro de la misma caché.
 */
export function conCache(params) {
  if (!params || !params.system) return params;
  const sistema = typeof params.system === 'string' ? [{ type: 'text', text: params.system }] : [...params.system];
  if (!sistema.length) return params;
  const ultimo = sistema.length - 1;
  sistema[ultimo] = { ...sistema[ultimo], cache_control: { type: 'ephemeral' } };
  return { ...params, system: sistema };
}

const percentil = (xs, p) => {
  if (!xs.length) return null;
  const o = [...xs].sort((a, b) => a - b);
  return Math.round(o[Math.min(o.length - 1, Math.floor(p * o.length))]);
};
const promedio = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/**
 * Cuánto tardó el agente en cada parte del turno, para dejar de adivinar dónde
 * está la lentitud: detectar que la persona terminó (eou), que Claude empiece
 * a responder (llm) y que la voz empiece a sonar (tts). Milisegundos.
 */
export function resumenLatencias(metricas = []) {
  const de = (tipo, campo) => metricas.filter(m => m && m.type === tipo && Number.isFinite(m[campo]) && m[campo] >= 0).map(m => m[campo]);
  const fila = (xs) => ({ promedio: promedio(xs), p90: percentil(xs, 0.9), n: xs.length });
  const eou = de('eou_metrics', 'endOfUtteranceDelayMs');
  const llm = de('llm_metrics', 'ttftMs');
  const tts = de('tts_metrics', 'ttfbMs');
  // Lo que siente la persona: desde que calla hasta que oye la respuesta.
  const total = eou.length && llm.length && tts.length ? (promedio(eou) + promedio(llm) + promedio(tts)) : null;
  return { eou_ms: fila(eou), llm_ttft_ms: fila(llm), tts_ttfb_ms: fila(tts), respuesta_ms: total };
}

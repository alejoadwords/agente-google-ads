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
    herramienta: (llamadaId, nombre, args) => post({ accion: 'herramienta', llamada_id: llamadaId, nombre, args }, 1),
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

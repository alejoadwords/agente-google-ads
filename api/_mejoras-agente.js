// api/_mejoras-agente.js — «Mejorar el agente», lo que no depende de la red.
//
// Nació revisando el agente de Certain nota por nota (14-10-2026): cada
// corrección fue de uno de tres tipos —gusto (una regla de cómo hablar),
// configuración (un campo que ya existía) o fallo de Acuarius (código)—. El
// cliente no puede seguir dependiendo de nosotros para los dos primeros, así
// que el entrenador clasifica la corrección y propone el cambio; el tercero se
// nos reporta como ticket. Aquí están el prompt del entrenador, la validación
// de lo que devuelve y la aplicación del cambio, todo puro y probado
// (pruebas/mejoras-agente.mjs). Solo se importa desde funciones edge.

export const TIPOS = ['regla', 'bienvenida', 'faq', 'contexto', 'calificacion', 'enrutado', 'frase_escalar', 'tono', 'fallo_plataforma'];
export const MAX_REGLAS = 40;
const corta = (v, n) => String(v ?? '').trim().slice(0, n);

// Los campos del agente que una mejora puede tocar. Nada más: ni el nombre, ni
// los canales, ni el estado. El historial guarda exactamente estos.
export const CAMPOS_AGENTE = ['reglas', 'bienvenida', 'faqs', 'business_ctx', 'escalate_phrase', 'tone'];

export function fotoDelAgente(agent, regla) {
  const a = {};
  for (const k of CAMPOS_AGENTE) a[k] = agent?.[k] ?? null;
  return { agente: a, regla: regla ?? null };
}

// ── El prompt del entrenador ────────────────────────────────────────────────
export function promptEntrenador(agent, regla) {
  const faqs = (agent.faqs || []).map((f, i) => `${i}. P: ${f.q}\n   R: ${f.a}`).join('\n') || '(ninguna)';
  const reglas = (agent.reglas || []).map((r, i) => `${i}. ${r.texto}`).join('\n') || '(ninguna)';
  const criterios = (regla?.criterios || []).map((c, i) => `${i}. ${c.pregunta}`).join('\n') || '(ninguno)';
  return `Eres el entrenador de agentes de Acuarius. Un cliente probó su agente de WhatsApp y te cuenta qué estuvo mal en UNA respuesta. Tu trabajo: entender qué quiere y proponer EL cambio más pequeño y preciso en la configuración del agente para que no vuelva a pasar.

CONFIGURACIÓN ACTUAL DEL AGENTE «${agent.name}»:
- Tono: ${agent.tone === 'formal' ? 'usted' : 'tú'}
- Mensaje de bienvenida fijo: ${agent.bienvenida ? JSON.stringify(agent.bienvenida) : '(ninguno: el agente saluda con sus palabras)'}
- Frase al pasar a un asesor: ${JSON.stringify(agent.escalate_phrase || '')}
- Identidad: ${corta(agent.persona, 2500)}
- Contexto del negocio (texto que el agente toma como cierto):
${corta(agent.business_ctx, 9000)}
- Preguntas frecuentes:
${faqs}
- Reglas que el cliente ya le enseñó:
${reglas}
- Lo que el agente debe averiguar en la conversación (calificación):
${criterios}
- Pregunta para saber a qué proceso va: ${JSON.stringify(regla?.enrutado?.pregunta || '')}

QUÉ TIPO DE CAMBIO ELEGIR (uno solo):
- "regla": cómo habla o se comporta (palabras que no debe usar, cómo despedirse, qué no mencionar, cuándo preguntar algo). Es lo más común.
- "bienvenida": el saludo del primer mensaje.
- "faq": una pregunta frecuente nueva o una respuesta que estaba mal.
- "contexto": un dato del negocio que falta o está mal (horario, precios, servicios, zonas, condiciones). Si hay que corregir un texto que ya está, usa buscar/reemplazar con el texto EXACTO que aparece arriba.
- "calificacion": algo que el agente debe averiguar y no averigua (o que sobra).
- "enrutado": la pregunta con la que decide a qué proceso va la persona.
- "frase_escalar": lo que dice al pasar la conversación a un asesor.
- "tono": tú o usted.
- "fallo_plataforma": el agente hizo algo que su configuración ya le prohíbe o que depende del sistema y no de cómo está configurado (aceptó una hora fuera del horario que sí está escrito, repitió una pregunta ya contestada, se inventó un precio, pidió un dato que ya tenía, no entendió algo obvio). Eso no se arregla en la configuración: se le reporta al equipo de Acuarius.

REGLAS PARA TI:
- Primero comprueba la corrección contra la conversación. Si el cliente afirma algo que no pasó (un precio, una hora o una frase que la respuesta no tiene), no propongas nada: en "pregunta" cuéntale lo que ves y pregúntale qué quiso decir. Un cambio basado en algo que no pasó empeora al agente.
- El agente hace UNA sola pregunta por mensaje y la elige él según lo que le falta averiguar. Si el cliente quiere que pregunte algo (para cuántas personas, si tiene mascotas, cómo financia), eso es "calificacion" ("agregar"), no una regla: como regla compite con su pregunta y la pierde.
- Lo que el sistema ya controla por código —respetar el presupuesto que dio la persona, el horario de atención y de llamadas, no inventar precios ni inmuebles, no repetir lo que ya contestó— no se arregla con una regla: si pasó, es "fallo_plataforma".
- UN cambio por propuesta. Si la corrección pide dos cosas, propón la más importante y pídele en "explicacion" que corrija la otra aparte, con otra corrección (tú no la harás sola). Nunca respondas sin el JSON.
- No inventes datos del negocio. Si la corrección necesita un dato que el cliente no dio (un precio, un horario), pídeselo en "pregunta" y no propongas el cambio.
- Una regla nueva es una instrucción corta, concreta y en segunda persona («Cuando te agradezcan, responde con gusto…»). No repitas una regla que ya existe: si es parecida, edítala.
- Nunca propongas algo que vaya contra la ley, contra la verdad, o que le quite al agente sus límites (no inventar precios, respetar el horario, no pedir datos de más).
- Si una regla nueva contradice una existente, edita la existente en vez de agregar otra.

RESPONDE SOLO CON UN JSON, sin texto alrededor:
{
  "tipo": "uno de los de arriba",
  "explicacion": "para el cliente, en español, 1-2 frases: qué pasó y qué vas a cambiar",
  "pregunta": "solo si te falta un dato para poder proponer el cambio; si no, omítelo",
  "cambio": {
    // regla:         {"texto": "…"}  o para editar una existente  {"indice": N, "texto": "…"}  o para quitarla {"indice": N, "quitar": true}
    // bienvenida:    {"texto": "…"}  (vacío para que vuelva a saludar con sus palabras)
    // faq:           {"q": "…", "a": "…"}  o para editar  {"indice": N, "q": "…", "a": "…"}
    // contexto:      {"buscar": "texto exacto actual", "reemplazar": "texto nuevo"}  o  {"agregar": "texto nuevo"}
    // calificacion:  {"agregar": "lo que debe averiguar"}  o  {"indice": N, "pregunta": "…"}  o  {"indice": N, "quitar": true}
    // enrutado:      {"pregunta": "…"}
    // frase_escalar: {"texto": "…"}
    // tono:          {"valor": "formal" | "informal"}
  },
  "ticket": {"asunto": "…", "detalle": "qué hizo el agente y qué debió hacer"}   // solo si tipo = fallo_plataforma
}`;
}

// ── Validar lo que devuelve el entrenador ───────────────────────────────────
// El JSON viene de un modelo: no se confía en nada. Devuelve { propuesta } o { error }.
export function validarPropuesta(bruto, agent, regla) {
  let p = bruto;
  if (typeof bruto === 'string') {
    const m = bruto.match(/\{[\s\S]*\}/);
    if (!m) return { error: 'El entrenador no devolvió una propuesta.' };
    try { p = JSON.parse(m[0]); } catch { return { error: 'El entrenador devolvió una propuesta ilegible.' }; }
  }
  if (!p || typeof p !== 'object') return { error: 'Propuesta vacía.' };
  const tipo = String(p.tipo || '');
  const explicacion = corta(p.explicacion, 600);
  // Una pregunta no cambia nada, así que vale con cualquier «tipo» (el modelo a
  // veces pone "pregunta").
  if (p.pregunta && String(p.pregunta).trim()) return { propuesta: { tipo: TIPOS.includes(tipo) ? tipo : 'regla', explicacion, pregunta: corta(p.pregunta, 400) } };
  if (!TIPOS.includes(tipo)) return { error: 'Tipo de cambio desconocido: ' + tipo };
  const c = p.cambio || {};
  const n = (v) => Number.isInteger(v) ? v : (/^\d+$/.test(String(v ?? '')) ? parseInt(v, 10) : null);
  let cambio = null;
  switch (tipo) {
    case 'regla': {
      const i = n(c.indice);
      const total = (agent.reglas || []).length;
      if (i !== null && (i < 0 || i >= total)) return { error: 'La regla a editar no existe.' };
      if (c.quitar && i !== null) cambio = { indice: i, quitar: true };
      else if (corta(c.texto, 400)) cambio = { ...(i !== null ? { indice: i } : {}), texto: corta(c.texto, 400) };
      if (cambio && i === null && total >= MAX_REGLAS) return { error: 'El agente ya tiene ' + MAX_REGLAS + ' reglas: edita o quita alguna antes de agregar otra.' };
      break;
    }
    case 'bienvenida': cambio = { texto: corta(c.texto, 1000) }; break;
    case 'faq': {
      const i = n(c.indice);
      if (i !== null && (i < 0 || i >= (agent.faqs || []).length)) return { error: 'La pregunta frecuente a editar no existe.' };
      if (corta(c.q, 300) && corta(c.a, 1500)) cambio = { ...(i !== null ? { indice: i } : {}), q: corta(c.q, 300), a: corta(c.a, 1500) };
      break;
    }
    case 'contexto':
      if (corta(c.buscar, 2000) && typeof c.reemplazar === 'string') {
        if (!String(agent.business_ctx || '').includes(String(c.buscar).trim())) return { error: 'El texto a corregir no aparece en el contexto del negocio.' };
        cambio = { buscar: String(c.buscar).trim(), reemplazar: corta(c.reemplazar, 3000) };
      } else if (corta(c.agregar, 3000)) cambio = { agregar: corta(c.agregar, 3000) };
      break;
    case 'calificacion': {
      if (!regla) return { error: 'Este agente no tiene calificación configurada.' };
      const i = n(c.indice);
      if (i !== null && (i < 0 || i >= (regla.criterios || []).length)) return { error: 'La pregunta de calificación no existe.' };
      if (c.quitar && i !== null) cambio = { indice: i, quitar: true };
      else if (i !== null && corta(c.pregunta, 500)) cambio = { indice: i, pregunta: corta(c.pregunta, 500) };
      else if (corta(c.agregar, 500)) cambio = { agregar: corta(c.agregar, 500) };
      break;
    }
    case 'enrutado':
      if (!regla?.enrutado) return { error: 'Este agente no tiene enrutado configurado.' };
      if (corta(c.pregunta, 500)) cambio = { pregunta: corta(c.pregunta, 500) };
      break;
    case 'frase_escalar': if (corta(c.texto, 400)) cambio = { texto: corta(c.texto, 400) }; break;
    case 'tono': if (['formal', 'informal'].includes(c.valor)) cambio = { valor: c.valor }; break;
    case 'fallo_plataforma': {
      // Del modelo llega en «ticket»; de vuelta del navegador, ya normalizado en «cambio».
      const t = p.ticket || p.cambio || {};
      cambio = { asunto: corta(t.asunto, 140) || 'El agente hizo algo que no debía', detalle: corta(t.detalle, 3000) };
      break;
    }
  }
  if (!cambio) return { error: 'La propuesta venía incompleta. Vuelve a intentarlo describiendo la corrección con otras palabras.' };
  return { propuesta: { tipo, explicacion, cambio } };
}

// ── Aplicar ─────────────────────────────────────────────────────────────────
// Devuelve el agente y la regla de calificación como quedarían, sin tocar los
// originales. El mismo resultado sirve para probar el cambio y para guardarlo.
export function aplicarPropuesta(agent, regla, propuesta, ahora = new Date().toISOString()) {
  const a = { ...agent };
  let r = regla ? JSON.parse(JSON.stringify(regla)) : regla;
  const c = propuesta.cambio || {};
  switch (propuesta.tipo) {
    case 'regla': {
      const lista = [...(a.reglas || [])];
      if (c.quitar) lista.splice(c.indice, 1);
      else if (Number.isInteger(c.indice)) lista[c.indice] = { ...lista[c.indice], texto: c.texto, editada_at: ahora };
      else lista.push({ id: 'r' + Date.parse(ahora).toString(36) + Math.random().toString(36).slice(2, 6), texto: c.texto, creada_at: ahora });
      a.reglas = lista;
      break;
    }
    case 'bienvenida': a.bienvenida = c.texto || null; break;
    case 'faq': {
      const lista = [...(a.faqs || [])];
      if (Number.isInteger(c.indice)) lista[c.indice] = { q: c.q, a: c.a };
      else lista.push({ q: c.q, a: c.a });
      a.faqs = lista;
      break;
    }
    case 'contexto':
      a.business_ctx = c.buscar
        ? String(a.business_ctx || '').replace(c.buscar, c.reemplazar)
        : (String(a.business_ctx || '').trimEnd() + '\n\n' + c.agregar).trim();
      break;
    case 'calificacion': {
      const lista = [...(r.criterios || [])];
      if (c.quitar) lista.splice(c.indice, 1);
      else if (Number.isInteger(c.indice)) lista[c.indice] = { ...lista[c.indice], pregunta: c.pregunta };
      else {
        const usadas = new Set(lista.map(x => x.clave));
        let k = lista.length + 1;
        while (usadas.has('criterio_' + k)) k++;
        lista.push({ clave: 'criterio_' + k, pregunta: c.agregar, condicion: '' });
      }
      r = { ...r, criterios: lista };
      break;
    }
    case 'enrutado': r = { ...r, enrutado: { ...r.enrutado, pregunta: c.pregunta } }; break;
    case 'frase_escalar': a.escalate_phrase = c.texto; break;
    case 'tono': a.tone = c.valor; break;
  }
  return { agente: a, regla: r };
}

// Lo que se le enseña al cliente: «antes» y «después» del campo que cambia.
export function resumenDelCambio(agent, regla, propuesta) {
  const c = propuesta.cambio || {};
  const t = propuesta.tipo;
  const titulo = {
    regla: c.quitar ? 'Quitar una regla' : Number.isInteger(c.indice) ? 'Editar una regla' : 'Nueva regla',
    bienvenida: 'Mensaje de bienvenida', faq: Number.isInteger(c.indice) ? 'Editar una pregunta frecuente' : 'Nueva pregunta frecuente',
    contexto: 'Contexto del negocio', calificacion: 'Lo que el agente averigua', enrutado: 'Pregunta para elegir el proceso',
    frase_escalar: 'Frase al pasar a un asesor', tono: 'Trato', fallo_plataforma: 'Reporte al equipo de Acuarius',
  }[t];
  let antes = '', despues = '';
  if (t === 'regla') { antes = Number.isInteger(c.indice) ? agent.reglas[c.indice]?.texto || '' : ''; despues = c.quitar ? '' : c.texto; }
  if (t === 'bienvenida') { antes = agent.bienvenida || ''; despues = c.texto || '(el agente saluda con sus palabras)'; }
  if (t === 'faq') { const f = Number.isInteger(c.indice) ? agent.faqs[c.indice] : null; antes = f ? 'P: ' + f.q + '\nR: ' + f.a : ''; despues = 'P: ' + c.q + '\nR: ' + c.a; }
  if (t === 'contexto') { antes = c.buscar || ''; despues = c.buscar ? c.reemplazar : c.agregar; }
  if (t === 'calificacion') { antes = Number.isInteger(c.indice) ? regla.criterios[c.indice]?.pregunta || '' : ''; despues = c.quitar ? '' : (c.pregunta || c.agregar); }
  if (t === 'enrutado') { antes = regla?.enrutado?.pregunta || ''; despues = c.pregunta; }
  if (t === 'frase_escalar') { antes = agent.escalate_phrase || ''; despues = c.texto; }
  if (t === 'tono') { antes = agent.tone === 'formal' ? 'Usted' : 'Tú'; despues = c.valor === 'formal' ? 'Usted' : 'Tú'; }
  if (t === 'fallo_plataforma') { antes = ''; despues = c.detalle; }
  return { titulo, antes, despues };
}

// ── El revisor (fase 3) ─────────────────────────────────────────────────────
// Lee una conversación real ya terminada y señala, como mucho, UNA respuesta
// del agente que salió mal. No propone el cambio: eso lo hace el entrenador de
// arriba, igual que si el problema lo hubiera escrito el dueño. Va con Haiku
// porque lee todas las conversaciones; el entrenador (Sonnet) solo entra
// cuando hay algo.

// Por cuenta y día: conversaciones que se revisan y sugerencias que se crean.
// Cada revisión cuesta ~0,007 USD; cada sugerencia, ~0,03 más.
export const CUPO_REVISION = {
  free: { conversaciones: 0, sugerencias: 0 },
  trial: { conversaciones: 5, sugerencias: 2 },
  pro: { conversaciones: 15, sugerencias: 3 },
  agency: { conversaciones: 50, sugerencias: 10 },
  admin: { conversaciones: 50, sugerencias: 10 },
};
export function cupoRevision(plan) {
  const p = String(plan || '').toLowerCase().trim();
  const alias = { individual: 'pro', agencia: 'agency' };
  return CUPO_REVISION[alias[p] || p] || CUPO_REVISION.pro;
}
export const MAX_PENDIENTES = 10;   // por agente: si nadie las mira, no se apilan más

// mensajes: [{ role, autor, content, nuevo }] en orden. Solo los del agente que
// llegaron después de la última revisión («nuevo») se pueden señalar.
export function transcripcionRevisor(mensajes) {
  return mensajes.map((m, i) => {
    const quien = m.role === 'user' ? 'CLIENTE'
      : m.autor === 'agente' ? (m.nuevo ? `AGENTE #${i}` : 'AGENTE (ya revisado)')
      : m.autor === 'equipo' ? 'PERSONA DEL EQUIPO' : 'MENSAJE AUTOMÁTICO';
    return quien + ':\n' + limpiarBloques(m.content);
  }).join('\n\n');
}

export function limpiarBloques(t) {
  return String(t || '').replace(/\[(CAPTURA|CALIFICACION|ESCALAR|RESERVA|CANCELAR_CITA|CAMBIAR_CITA|FOTOS)\b[\s\S]*?\](\s*\])?/g, '').trim().slice(0, 3000);
}

export function promptRevisor(agent, descartadas = [], canal = 'whatsapp') {
  const reglas = (agent.reglas || []).map(r => '- ' + r.texto).join('\n') || '(ninguna)';
  const desc = descartadas.filter(Boolean).slice(0, 15).map(d => '- ' + d).join('\n');
  const formato = canal === 'whatsapp'
    ? 'En WhatsApp la negrita es con UN asterisco (*así*); con dos (**así**) el cliente ve los asteriscos. Tampoco existen los títulos con # ni las tablas.'
    : 'En este canal no hay ningún formato: asteriscos, guiones bajos o # se ven tal cual.';
  return `Revisas conversaciones reales de ${canal === 'whatsapp' ? 'WhatsApp' : canal} entre clientes y el agente de IA «${agent.name}» de un negocio. Tu trabajo: encontrar la respuesta del agente que su dueño querría corregir, si la hay.

LO QUE EL AGENTE SABE DEL NEGOCIO (resumen):
${corta(agent.business_ctx, 3500)}

REGLAS QUE EL DUEÑO YA LE ENSEÑÓ:
${reglas}
${desc ? `
EL DUEÑO YA DESCARTÓ ESTAS OBSERVACIONES (no las vuelvas a señalar ni algo equivalente):
${desc}
` : ''}
QUÉ CUENTA COMO PROBLEMA (tiene que ser claro, no una preferencia tuya):
- Ignoró o no respondió algo que el cliente preguntó o dijo.
- Repitió una pregunta que el cliente ya había contestado.
- Dio un dato que contradice lo que sabe del negocio, o se inventó algo.
- Incumplió una de las reglas del dueño.
- Aceptó o propuso algo fuera del horario o de las condiciones del negocio.
- El cliente pidió hablar con una persona y no se le pasó.
- El cliente se molestó o se fue por cómo respondió el agente.
- Un tono claramente inadecuado para un negocio (frío, grosero, robótico, demasiado largo para un chat).
- Formato que el cliente ve roto. ${formato}

QUÉ NO ES PROBLEMA: que el cliente no comprara; detalles de estilo que ninguna regla pide; algo que dijo una PERSONA DEL EQUIPO o un MENSAJE AUTOMÁTICO (no son del agente); respuestas "AGENTE (ya revisado)".

Solo puedes señalar mensajes marcados "AGENTE #n". Si no hay un problema claro, lo correcto es no señalar nada: la mayoría de conversaciones están bien.

RESPONDE SOLO CON UN JSON, sin texto alrededor:
{"indice": n o null, "gravedad": "alta" | "media", "problema": "qué estuvo mal y qué debió hacer, en 1-2 frases, como se lo diría el dueño a un asesor nuevo"}`;
}

// Devuelve { indice, problema } o null. Lo que no cuadre se descarta en
// silencio: una sugerencia de más es ruido que enseña a ignorarlas.
export function validarRevision(bruto, mensajes) {
  const m = String(bruto || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  let p; try { p = JSON.parse(m[0]); } catch { return null; }
  if (p == null || p.indice == null) return null;
  const i = Number.isInteger(p.indice) ? p.indice : (/^#?\d+$/.test(String(p.indice)) ? parseInt(String(p.indice).replace('#', ''), 10) : null);
  if (i === null || !mensajes[i]) return null;
  const msg = mensajes[i];
  if (msg.role !== 'assistant' || msg.autor !== 'agente' || !msg.nuevo) return null;
  if (!['alta', 'media'].includes(p.gravedad)) return null;
  const problema = corta(p.problema, 600);
  if (problema.length < 10) return null;
  return { indice: i, problema, gravedad: p.gravedad };
}

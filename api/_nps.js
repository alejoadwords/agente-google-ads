// api/_nps.js — la encuesta de satisfacción, tal como la configura cada cuenta
//
// Antes todo era fijo salvo tres textos del correo, y esos vivían en el paso de
// la automatización: quien tenía cuatro automatizaciones que mandaban encuesta
// tenía cuatro encuestas distintas sin querer. La encuesta es de la empresa, no
// de un flujo, así que la configuración vive en la cuenta y el paso solo puede
// sobreescribir el asunto y la intro del correo.
//
// Se guarda como las reseñas: UNA fila en `user_profiles` por cuenta, con un
// mapa por cliente dentro. Una agencia que lleva ocho clientes tiene ocho
// encuestas distintas y una sola fila.

export const NPS_KEY = '__nps__';

// Lo que ve quien nunca la ha tocado. Es también la referencia de qué se puede
// cambiar: si un campo no está aquí, no es configurable.
export const NPS_POR_DEFECTO = {
  // El correo
  asunto:   '¿Nos recomendarías? — 5 segundos',
  intro:    'Hola {{nombre}}, tu opinión nos ayuda a mejorar. Solo te tomará 5 segundos:',
  pregunta: '¿Qué tan probable es que nos recomiendes a un amigo o colega?',
  etiquetaMin: '0 = Nada probable',
  etiquetaMax: '10 = Muy probable',

  // La página que se abre al pulsar una nota
  gracias:     '¡Gracias! Registramos tu {nota}/10',
  pieDetractor: '¿Qué deberíamos mejorar? Tu respuesta llega directo al equipo.',
  pieNeutro:    '¿Qué nos falta para llegar a un 10?',
  piePromotor:  '¿Algo que quieras contarnos?',
  comentarioPlaceholder: 'Escribe aquí (opcional)…',
  boton:       'Enviar',
  finalTitulo: '¡Gracias por tu comentario!',
  finalTexto:  'Lo leeremos con atención.',

  // Marca
  logoUrl: '',            // vacío = el logo de Acuarius
  color:   '#1E2BCC',

  // Preguntas adicionales, después de la nota
  preguntas: [],
};

// Tipos de pregunta. El reporte sabe qué hacer con cada uno: las escalas se
// promedian y se reparten, el texto se lista.
export const TIPOS_PREGUNTA = {
  texto:    { etiqueta: 'Respuesta escrita', numerica: false },
  escala5:  { etiqueta: 'Escala 1 a 5',      numerica: true, max: 5 },
  escala10: { etiqueta: 'Escala 1 a 10',     numerica: true, max: 10 },
};

const LIMITES = { preguntas: 8, texto: 160, respuestaTexto: 600 };

// Un color que el navegador pueda poner sin colarse en el HTML. Se mete dentro
// de un atributo `style`, así que aquí no se acepta nada que no sea #rrggbb.
function colorSeguro(v) {
  return /^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? String(v) : NPS_POR_DEFECTO.color;
}

// Una URL de imagen, y solo eso: un `javascript:` en el logo se ejecutaría en
// la página que abre el cliente final.
function urlSegura(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  return /^https:\/\/[^\s"'<>]+$/i.test(s) ? s : '';
}

/**
 * Deja la configuración en su forma buena: completa lo que falte con los
 * valores por defecto y tira lo que no reconoce. Se usa igual al leer que al
 * guardar, para que una fila vieja o manipulada no llegue nunca a la página.
 */
export function normalizarNps(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  const texto = (k, max = 300) => {
    const v = c[k] === undefined || c[k] === null ? NPS_POR_DEFECTO[k] : String(c[k]);
    const t = v.trim().slice(0, max);
    // Un texto en blanco no deja la pantalla muda: vuelve el de por defecto.
    return t || NPS_POR_DEFECTO[k];
  };
  const preguntas = [];
  for (const p of Array.isArray(c.preguntas) ? c.preguntas : []) {
    const tipo = TIPOS_PREGUNTA[p?.tipo] ? p.tipo : 'texto';
    const t = String(p?.texto || '').trim().slice(0, LIMITES.texto);
    if (!t) continue; // una pregunta sin enunciado no se muestra
    preguntas.push({
      id: String(p?.id || '').match(/^p[0-9a-z]{1,16}$/i) ? p.id : 'p' + (preguntas.length + 1) + Date.now().toString(36).slice(-4),
      tipo, texto: t, obligatoria: !!p?.obligatoria,
    });
    if (preguntas.length >= LIMITES.preguntas) break;
  }
  return {
    asunto: texto('asunto'), intro: texto('intro'), pregunta: texto('pregunta'),
    etiquetaMin: texto('etiquetaMin', 40), etiquetaMax: texto('etiquetaMax', 40),
    gracias: texto('gracias'), pieDetractor: texto('pieDetractor'),
    pieNeutro: texto('pieNeutro'), piePromotor: texto('piePromotor'),
    comentarioPlaceholder: texto('comentarioPlaceholder'), boton: texto('boton', 40),
    finalTitulo: texto('finalTitulo'), finalTexto: texto('finalTexto'),
    logoUrl: urlSegura(c.logoUrl), color: colorSeguro(c.color),
    preguntas,
  };
}

/** La configuración de una cuenta y su cliente, ya normalizada. */
export async function leerNps(sbUrl, sbKey, userId, clientId) {
  try {
    const r = await fetch(
      `${sbUrl}/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(userId)}` +
      `&agent_key=eq.${NPS_KEY}&select=profile_data&limit=1`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
    );
    const todo = (await r.json())?.[0]?.profile_data || {};
    return normalizarNps(todo[clientId || '_cuenta']);
  } catch {
    // Que no se pueda leer la configuración NO deja la encuesta sin enviar:
    // sale la de por defecto, que es exactamente la de antes de esta pantalla.
    return normalizarNps(null);
  }
}

/** El pie que corresponde a la nota. */
export function pieSegunNota(cfg, nota) {
  return nota >= 9 ? cfg.piePromotor : nota >= 7 ? cfg.pieNeutro : cfg.pieDetractor;
}

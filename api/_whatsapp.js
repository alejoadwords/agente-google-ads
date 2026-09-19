// api/_whatsapp.js — piezas compartidas de WhatsApp.
//
// Vive aquí y no dentro de un endpoint porque lo usan varios: la pantalla de
// plantillas y el gate de las campañas. El guion bajo evita que Vercel lo
// publique como ruta. Solo se importa desde funciones EDGE.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export const GRAPH = 'https://graph.facebook.com/v23.0';

function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  };
}

/**
 * La conexión de WhatsApp de una cuenta, con lo que hace falta para hablar con
 * Meta: `external_id` es el phone_number_id (por donde se envía) y `waba_id` la
 * cuenta de negocio (de donde cuelgan las plantillas). Son cosas distintas y
 * confundirlas da un 404 de Meta que no explica nada.
 */
export async function conexionWhatsapp(userId, clientId) {
  const scope = clientId ? `&client_id=eq.${encodeURIComponent(clientId)}` : '';
  const filas = await fetch(
    `${SUPABASE_URL}/rest/v1/channel_connections?user_id=eq.${encodeURIComponent(userId)}` +
    `&channel=eq.whatsapp&is_active=eq.true${scope}&select=id,external_id,waba_id,access_token,channel_name&limit=1`,
    { headers: sbHeaders() }
  ).then(r => (r.ok ? r.json() : [])).catch(() => []);
  return filas?.[0] || null;
}

/**
 * Las plantillas de una WABA, tal y como las ve Meta. Devuelve
 * { ok, plantillas } o { ok:false, aviso }.
 */
export async function plantillasDeMeta(conn, campos) {
  const r = await fetch(
    `${GRAPH}/${encodeURIComponent(conn.waba_id)}/message_templates` +
    `?fields=${campos || 'name,status,category,language,components,quality_score,rejected_reason'}&limit=200`,
    { headers: { Authorization: `Bearer ${conn.access_token}` } }
  );
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) {
    return { ok: false, aviso: String(d.error?.message || r.status).slice(0, 200) };
  }
  return { ok: true, plantillas: d.data || [] };
}

/**
 * Cuántas variables {{n}} usa cada parte de la plantilla. Es lo que la pantalla
 * necesita para pedir un campo del lead por cada hueco: si el mapeo no cuadra
 * con los huecos, Meta rechaza el envío entero.
 */
export function huecosDe(components) {
  const cuenta = (texto) => {
    const vistos = new Set();
    for (const m of String(texto || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)) vistos.add(Number(m[1]));
    return vistos.size ? Math.max(...vistos) : 0;
  };
  const out = { header: 0, body: 0, cuerpo_texto: '' };
  for (const c of (components || [])) {
    if (c.type === 'HEADER' && c.format === 'TEXT') out.header = cuenta(c.text);
    if (c.type === 'BODY') { out.body = cuenta(c.text); out.cuerpo_texto = c.text || ''; }
  }
  return out;
}

// ── Escribir una plantilla ───────────────────────────────────────────────────
// Meta revisa cada plantilla y rechazarla cuesta días. Casi todos los rechazos
// que se pueden evitar se ven ANTES de enviarla, así que esto valida aquí lo
// que Meta validaría allá, y de paso construye el campo `example`, que es
// obligatorio cuando hay variables y es lo que más se olvida.

export const LIMITES = { header: 60, body: 1024, footer: 60, nombre: 512 };

const variablesDe = (t) => [...String(t || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map(m => Number(m[1]));

/**
 * Revisa una plantilla antes de mandarla. Devuelve { errores[], avisos[] }:
 * los errores impiden enviarla, los avisos son motivos de rechazo frecuentes
 * que no podemos dar por seguros.
 */
export function revisarBorrador(b) {
  const errores = [], avisos = [];
  const nombre = String(b.name || '');
  if (!nombre) errores.push('La plantilla necesita un nombre.');
  else if (!/^[a-z0-9_]+$/.test(nombre)) {
    errores.push('El nombre solo admite minúsculas, números y guiones bajos — sin espacios ni tildes.');
  } else if (nombre.length > LIMITES.nombre) errores.push('El nombre es demasiado largo.');

  if (!['MARKETING', 'UTILITY'].includes(b.category)) {
    errores.push('Elige si la plantilla es de marketing o de utilidad.');
  }

  const cuerpo = String(b.body || '').trim();
  if (!cuerpo) errores.push('El mensaje no puede estar vacío.');
  if (cuerpo.length > LIMITES.body) errores.push(`El mensaje pasa de ${LIMITES.body} caracteres.`);

  // Los huecos tienen que ser 1, 2, 3… sin saltos. Meta no lo exige, pero
  // nuestro envío manda los valores por posición: con un {{1}} y un {{3}} el
  // tercero recibiría el valor del segundo y nadie entendería el mensaje.
  const revisarHuecos = (texto, donde) => {
    const vs = variablesDe(texto);
    if (!vs.length) return 0;
    const unicos = [...new Set(vs)].sort((a, b) => a - b);
    const esperado = unicos.map((_, i) => i + 1);
    if (unicos.join(',') !== esperado.join(',')) {
      errores.push(`Los huecos de ${donde} deben ir numerados 1, 2, 3… sin saltarse ninguno.`);
    }
    return Math.max(...unicos);
  };

  const encabezado = String(b.header || '').trim();
  if (encabezado.length > LIMITES.header) errores.push(`El título pasa de ${LIMITES.header} caracteres.`);
  const nHeader = revisarHuecos(encabezado, 'el título');
  if (nHeader > 1) errores.push('El título admite un solo hueco.');

  const nBody = revisarHuecos(cuerpo, 'el mensaje');

  const pie = String(b.footer || '').trim();
  if (pie.length > LIMITES.footer) errores.push(`El pie pasa de ${LIMITES.footer} caracteres.`);
  if (variablesDe(pie).length) errores.push('El pie no admite huecos.');

  // Cada hueco necesita un ejemplo: sin él Meta rechaza la plantilla sin
  // revisarla siquiera.
  const ejH = (b.ejemplos_header || []).filter(x => String(x || '').trim());
  const ejB = (b.ejemplos_body || []).filter(x => String(x || '').trim());
  if (nHeader && ejH.length < nHeader) errores.push('Falta el ejemplo del hueco del título.');
  if (nBody && ejB.length < nBody) {
    errores.push(nBody === 1
      ? 'Falta el ejemplo del hueco del mensaje.'
      : `Faltan ejemplos: hay ${nBody} huecos en el mensaje.`);
  }

  // Motivos de rechazo frecuentes que no son reglas duras.
  if (/^\s*\{\{\s*\d+\s*\}\}/.test(cuerpo) || /\{\{\s*\d+\s*\}\}\s*$/.test(cuerpo)) {
    avisos.push('Meta suele rechazar los mensajes que empiezan o terminan con un hueco. Escribe algo antes y después.');
  }
  const soloTexto = cuerpo.replace(/\{\{\s*\d+\s*\}\}/g, '').trim();
  if (nBody && soloTexto.length < nBody * 10) {
    avisos.push('Hay poco texto propio para tantos huecos; Meta lo suele leer como plantilla genérica.');
  }
  if (b.category === 'UTILITY' && /\b(promo|promoci|descuento|oferta|rebaja|gratis)\b/i.test(cuerpo)) {
    avisos.push('El texto suena a promoción pero la categoría es utilidad. Meta la recategoriza y puede cobrarla distinto.');
  }
  return { errores, avisos };
}

/** Traduce el borrador al formato de componentes que espera Meta. */
export function componentesDe(b) {
  const comps = [];
  const encabezado = String(b.header || '').trim();
  if (encabezado) {
    const c = { type: 'HEADER', format: 'TEXT', text: encabezado };
    const n = [...new Set(variablesDe(encabezado))].length;
    // `header_text` es un arreglo plano; `body_text` es un arreglo DE
    // arreglos. Confundirlos da un error de Meta que no dice cuál de los dos.
    if (n) c.example = { header_text: (b.ejemplos_header || []).slice(0, n).map(String) };
    comps.push(c);
  }
  const cuerpo = String(b.body || '').trim();
  const cBody = { type: 'BODY', text: cuerpo };
  const nB = [...new Set(variablesDe(cuerpo))].length;
  if (nB) cBody.example = { body_text: [(b.ejemplos_body || []).slice(0, nB).map(String)] };
  comps.push(cBody);

  const pie = String(b.footer || '').trim();
  if (pie) comps.push({ type: 'FOOTER', text: pie });

  // Un solo botón de enlace, con URL fija. Los de respuesta rápida y los de
  // teléfono se dejan para más adelante: cada tipo trae sus propias reglas.
  const btn = b.boton;
  if (btn && btn.text && /^https?:\/\//i.test(btn.url || '')) {
    comps.push({ type: 'BUTTONS', buttons: [{ type: 'URL', text: String(btn.text).slice(0, 25), url: String(btn.url).slice(0, 2000) }] });
  }
  return comps;
}

/** Crea la plantilla en Meta y la deja en revisión. */
export async function crearPlantilla(conn, borrador) {
  const r = await fetch(`${GRAPH}/${encodeURIComponent(conn.waba_id)}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${conn.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: borrador.name,
      language: borrador.language || 'es',
      category: borrador.category,
      components: componentesDe(borrador),
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) {
    return { ok: false, aviso: String(d.error?.error_user_msg || d.error?.message || r.status).slice(0, 300) };
  }
  return { ok: true, id: d.id, status: d.status || 'PENDING', category: d.category };
}

/** Borra una plantilla. Hace falta para rehacer una rechazada con el mismo nombre. */
export async function borrarPlantilla(conn, nombre) {
  const r = await fetch(
    `${GRAPH}/${encodeURIComponent(conn.waba_id)}/message_templates?name=${encodeURIComponent(nombre)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${conn.access_token}` } }
  );
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) return { ok: false, aviso: String(d.error?.message || r.status).slice(0, 200) };
  return { ok: true };
}

/**
 * Quién es la CUENTA cuando quien pregunta es un miembro del equipo. Sin esto
 * un vendedor vería su propia cuenta —que no tiene ningún canal— y creería que
 * no hay plantillas.
 */
export async function cuentaDe(userId) {
  const tm = await fetch(
    `${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id&limit=1`,
    { headers: sbHeaders() }
  ).then(r => (r.ok ? r.json() : [])).catch(() => []);
  return tm?.[0]?.owner_user_id || userId;
}

// api/form-public.js
// Cara pública de los formularios de captura:
// GET  ?token= → definición pública (para /form/<token> y el embed)
// POST ?token= → envío: crea/mergea el lead (via _lead-intake) y dispara
//                automatizaciones. Honeypot _hp contra bots (responde ok
//                sin crear nada). Acepta JSON y form-urlencoded.
export const config = { runtime: 'edge' };

import { intakeLead, pick, camposDePauta } from './_lead-intake.js';
import { decidirDestino, desanidarCorchetes, rotulo, esRuido, paginaCorta, campana } from './_reglas-destino.js';
import { registrarError } from './_registro-errores.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'return=representation',
  };
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// Cuánto puede esperar quien nos llama antes de que demos el envío por bueno.
//
// El Webhook de Elementor usa wp_remote_post, y el tiempo de espera por defecto
// de WordPress es de CINCO segundos. En frío tardábamos 5,7 s: WordPress se
// rendía y le pintaba «Your submission failed» al visitante mientras nosotros
// creábamos el lead igual. El visitante se va creyendo que el formulario está
// roto, que es el peor final posible para un lead que ya era nuestro.
const MARGEN_MS = 3500;
const SIN_TERMINAR = Symbol('sin terminar');

export default async function handler(req, contexto) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const token = String(url.searchParams.get('token') || '');
  if (!/^[a-f0-9]{24,64}$/i.test(token)) return jsonResp({ error: 'Formulario no encontrado' }, 404);

  const rows = await fetch(`${SUPABASE_URL}/rest/v1/lead_forms?token=eq.${encodeURIComponent(token)}&select=*&limit=1`, { headers: sbHeaders() }).then(r => r.json()).catch(() => []);
  const form = rows?.[0];
  if (!form) return jsonResp({ error: 'Formulario no encontrado' }, 404);

  if (req.method === 'GET') {
    if (!form.active) return jsonResp({ error: 'Este formulario está pausado' }, 410);
    // Un conector no tiene página propia: solo recoge envíos de una web ajena.
    // Sin esto, /form/<token> pintaría un formulario vacío con un botón inútil.
    if (form.tipo === 'conector') return jsonResp({ error: 'Este enlace no es un formulario' }, 404);
    return jsonResp({
      form: {
        title: form.title || form.name,
        description: form.description,
        button_text: form.button_text || 'Enviar',
        success_message: form.success_message || '¡Gracias! Recibimos tus datos y te contactaremos pronto.',
        redirect_url: form.redirect_url,
        accent_color: form.accent_color || '#2563EB',
        fields: form.fields || [],
      },
    });
  }

  if (req.method !== 'POST') return jsonResp({ error: 'Método no permitido' }, 405);
  if (!form.active) return jsonResp({ error: 'Este formulario está pausado' }, 410);

  let body = {};
  try {
    const text = await req.text();
    // El conector manda JSON como text/plain a propósito: es el único tipo que
    // sendBeacon puede usar sin disparar un preflight de CORS (y sendBeacon no
    // sabe hacer preflight, así que el navegador tiraba el envío en silencio).
    // Por eso se mira el contenido, no la cabecera.
    const t = text.trim();
    if (t.startsWith('{')) body = JSON.parse(t);
    else body = Object.fromEntries(new URLSearchParams(text));
  } catch { return jsonResp({ error: 'Datos inválidos' }, 400); }

  // Honeypot: los bots llenan el campo oculto — responder ok sin crear nada
  if (body._hp) return jsonResp({ ok: true });

  // Elementor Forms manda `form_fields[email]`, no `email`. Sin desanidar, un
  // envío perfectamente válido entraba sin datos de contacto y lo rechazábamos
  // con un 400 que en su web no se ve: el lead se perdía sin que nadie supiera.
  const crudo = body;                      // guarda los tipos que manda Elementor
  body = desanidarCorchetes(body);
  const tipoDe = (k) => crudo['fields[' + k + '][type]'] || null;

  const name = pick(body, 'name', 'nombre', 'full_name', 'fullname');
  const email = pick(body, 'email', 'correo', 'mail');
  const phone = pick(body, 'phone', 'telefono', 'teléfono', 'tel', 'whatsapp', 'celular');
  if (!name && !email && !phone) return jsonResp({ error: 'Faltan datos de contacto' }, 400);

  // ── La nota ────────────────────────────────────────────────────────────
  // Una línea por dato, con su rótulo, y fuera el ruido. Quien abre la ficha
  // va a llamar a esta persona: necesita qué pidió y de dónde vino.
  const known = new Set(['name', 'nombre', 'full_name', 'fullname', 'email', 'correo', 'mail', 'phone', 'telefono', 'teléfono', 'tel', 'whatsapp', 'celular', 'company', 'empresa', 'negocio', '_hp', 'token', '_page',
    // Fontanería de Elementor: identificadores internos que no le dicen nada a
    // quien va a llamar al lead. `referer_title` sí, pero va aparte, a su campo.
    'form_id', 'post_id', 'queried_id', 'referer_title', 'referrer', 'page_url', 'page_title', 'form_name', 'user_agent', 'remote_ip',
  ]);
  // Los originales con corchetes ya están desanidados: contarlos otra vez
  // llenaría la nota con cada campo repetido dos veces.
  for (const k of Object.keys(body)) if (/^[^\[\]]+\[[^\[\]]+\]$/.test(k)) known.add(k.toLowerCase());

  const lineas = [];
  let mensaje = null;
  for (const [k, v] of Object.entries(body)) {
    if (known.has(k.toLowerCase())) continue;
    if (esRuido(k, v, tipoDe(k))) continue;
    const valor = String(v).trim().slice(0, 400);
    // El mensaje libre va al final: es el largo, y leerlo primero empuja el
    // resto fuera de la vista.
    if (/^(message|mensaje|comentario|comments?)$/i.test(k)) { mensaje = valor; continue; }
    const r = rotulo(k);
    lineas.push(r ? r + ': ' + valor : valor);
    if (lineas.length >= 8) break;
  }
  if (mensaje) lineas.push('Mensaje: ' + mensaje);

  const page = pick(body, '_page', 'page_url', 'referrer');
  const corta = paginaCorta(page);
  if (corta) lineas.push('Página: ' + corta);
  const campa = campana(page);
  if (campa) lineas.push('Campaña: ' + campa);

  const noteParts = lineas;

  // ¿A qué tablero va y quién lo atiende? Lo decide la regla del conector a
  // partir de un campo del propio formulario: una inmobiliaria manda «Comprar»
  // o «Arrendar» en el mismo formulario de todas sus fichas.
  const destino = decidirDestino(form.reglas, body, {
    pipeline_id: form.pipeline_id, assigned_to: form.assigned_to, tags: form.tags,
  });
  // Cuando la regla acertó, la respuesta del visitante ya está arriba y repetir
  // "Destino: Arrendar" solo alarga la nota. Se anota justo cuando hace falta
  // una explicación: cuando NO coincidió con ninguna rama y el lead cayó en el
  // tablero de reserva. Ahí sí, sin esto habría que adivinarlo.
  if (destino.caso === 'sin coincidencia') {
    noteParts.push('No coincidió con ninguna regla: entró al tablero por defecto');
  }

  // La referencia del inmueble (o del producto) que la web manda junto al
  // envío. Va a campos propios y no a la nota porque así se puede ver como
  // columna en la lista y filtrar por ella.
  const referencia = pick(body, 'referer_title', 'referencia', 'inmueble', 'producto', 'sku');

  // De dónde vino esta persona. El conector manda `_origen` con lo que traía la
  // URL de aterrizaje —gclid, utm, campaignid—, guardado desde que entró aunque
  // rellenara el formulario tres páginas después.
  //
  // Va a CAMPOS PROPIOS, no a la nota. Antes la campaña se escribía en la nota
  // como texto libre y ahí el reporte de pauta no la ve: cuenta los leads por
  // `custom_fields['Campaña']` y por `['ID de campaña']`. El dato se capturaba
  // y se tiraba donde nadie podía usarlo.
  const orig = (body && typeof body._origen === 'object' && body._origen) ? body._origen : {};
  const desdeUrl = {};
  try {
    // Los parámetros de la propia URL del envío también cuentan: es el caso de
    // quien aterriza y rellena sin moverse de página.
    const u = new URL(String(page || ''));
    for (const [k, v] of u.searchParams.entries()) if (v) desdeUrl[k] = v;
  } catch {}
  const pauta = camposDePauta({ ...desdeUrl, ...orig, ...body });

  const camposPropios = (referencia || Object.keys(pauta).length)
    ? { ...(referencia ? { referencia: referencia.slice(0, 120) } : {}), ...pauta }
    : null;

  // El trabajo de verdad, en una sola promesa que se pueda cronometrar.
  const trabajo = (async () => {
    const { created } = await intakeLead(form.user_id, form.client_id, {
      name, email, phone,
      company: pick(body, 'company', 'empresa', 'negocio'),
      // Arranca con un salto para que la cabecera «📥 [Web …]» que pone
      // intakeLead se quede sola en su línea y los datos empiecen debajo.
      note: noteParts.length ? '\n' + noteParts.join('\n') : null,
      source: 'formulario',
      // "Web: Web certainpezzano.com" — el prefijo se duplicaba con el nombre
      // que el cliente ya le había puesto a su conexión. Solo se antepone si
      // hace falta para entender de dónde viene.
      sourceLabel: form.tipo === 'conector'
        ? (/^web\b/i.test(form.name) ? form.name : 'Web: ' + form.name)
        : 'Formulario: ' + form.name,
      tags: destino.tags || [],
      // Si esta fuente tiene ejecutivo fijo, manda sobre el reparto por turnos.
      assignedTo: destino.assignedTo || null,
      pipelineId: destino.pipelineId || null,
      repartoClave: destino.repartoClave || null,
      repartoEntre: destino.repartoEntre || null,
      repartoTurnos: destino.repartoTurnos === true,
      ...(camposPropios ? { custom_fields: camposPropios } : {}),
    });
    await fetch(`${SUPABASE_URL}/rest/v1/lead_forms?id=eq.${form.id}`, {
      method: 'PATCH', headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
      // aviso_silencio_at vuelve a null: si el conector estuvo callado, se avisó
      // y ahora revive, un segundo apagón tiene que volver a avisar.
      body: JSON.stringify({
        submissions: (form.submissions || 0) + 1,
        last_submission_at: new Date().toISOString(),
        aviso_silencio_at: null,
      }),
    }).catch(() => {});
    return created;
  })();

  // Se le pone un cronómetro. Si termina a tiempo contestamos lo que pasó de
  // verdad —errores incluidos, que para eso están—; si se alarga, contestamos
  // que lo recibimos y lo terminamos en waitUntil. No es tragarse el fallo: lo
  // que NO puede pasar es que el visitante vea «error» por un lead que ya es
  // nuestro. Si el trabajo falla después, queda en el registro de errores.
  const puedeSeguirDespues = !!(contexto && typeof contexto.waitUntil === 'function');
  const envuelto = trabajo.then(
    created => ({ created }),
    e => ({ fallo: e })
  );

  let desenlace;
  if (puedeSeguirDespues) {
    let avisar;
    const reloj = new Promise(r => { avisar = r; });
    const t = setTimeout(() => avisar(SIN_TERMINAR), MARGEN_MS);
    desenlace = await Promise.race([envuelto, reloj]);
    clearTimeout(t);
  } else {
    // Sin waitUntil, abandonar la promesa la mata: mejor esperar.
    desenlace = await envuelto;
  }

  const respuesta = {
    ok: true,
    redirect_url: form.redirect_url || null,
    success_message: form.success_message || '¡Gracias! Recibimos tus datos y te contactaremos pronto.',
  };

  if (desenlace === SIN_TERMINAR) {
    contexto.waitUntil(envuelto.then(r => {
      if (r && r.fallo) {
        return registrarError({
          origen: 'form-public', donde: 'intake tardío', error: r.fallo,
          detalle: 'Conector: ' + form.name + ' (' + form.id + '). Ya habíamos respondido ok.',
        });
      }
    }));
    // `created` no se sabe todavía y no se inventa.
    return jsonResp({ ...respuesta, created: null, en_proceso: true });
  }

  if (desenlace.fallo) {
    await registrarError({ origen: 'form-public', donde: 'intake', error: desenlace.fallo, detalle: 'Conector: ' + form.name });
    return jsonResp({ error: 'No se pudo procesar el envío' }, 500);
  }
  return jsonResp({ ...respuesta, created: desenlace.created });
}

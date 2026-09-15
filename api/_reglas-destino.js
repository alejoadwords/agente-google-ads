// api/_reglas-destino.js — a qué tablero y a quién va un envío del conector.
//
// El problema que resuelve: una web tiene UN formulario repetido en todas sus
// páginas, pero dentro trae un desplegable que decide de qué es el lead
// («Comprar» o «Arrendar», «Soporte» o «Ventas»…). Duplicar el formulario no
// sirve, porque no lo decide la página: lo decide quien escribe. Así que el
// conector es uno solo y el reparto se configura aquí.
//
// Solo para funciones EDGE. Ver la nota de CLAUDE.md sobre api/_*.js.

/**
 * Forma de `reglas` (columna jsonb de lead_forms). Null = sin reglas.
 * {
 *   campo: 'field_a74788e',                    // el name del campo que decide
 *   casos: [
 *     { vale: 'Arrendar', pipeline_id: '…', tags: ['arriendo'],
 *       reparto: { modo: 'turnos', entre: ['user_a','user_b'] } },
 *     { vale: 'Comprar',  pipeline_id: '…', tags: ['venta'],
 *       reparto: { modo: 'fijo', quien: 'user_c' } },
 *   ],
 *   sino: { pipeline_id: null, tags: [], reparto: null },   // no coincidió nada
 * }
 *
 * `pipeline_id: null` no significa «ninguno»: significa el tablero por defecto
 * de la cuenta, que ya se elige en el CRM con la casilla «proceso por defecto».
 * No duplicamos esa decisión aquí.
 */

// Sin tildes, sin mayúsculas y sin espacios de sobra. Un cliente escribe
// «Arriendo» en Acuarius y su web manda «arriendo » o «ARRENDAR»: si la regla
// no salta por una tilde, el lead se va al tablero equivocado y nadie entiende
// por qué.
export function normaliza(v) {
  return String(v == null ? '' : v)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim();
}

function coincide(valorEnviado, valorDeLaRegla) {
  const a = normaliza(valorEnviado);
  const b = normaliza(valorDeLaRegla);
  if (!a || !b) return false;
  // Igualdad primero; «contiene» después, para que configurar «arrend» siga
  // funcionando si mañana la web cambia la opción de «Arrendar» a «Arriendo».
  return a === b || a.includes(b);
}

/**
 * Decide el destino de un envío.
 *
 * @param reglas  el jsonb del conector (o null)
 * @param body    el envío ya normalizado (claves sin corchetes)
 * @param base    lo que el conector trae de fábrica: { pipeline_id, assigned_to, tags }
 * @returns { pipelineId, assignedTo, tags, repartoClave, repartoEntre, caso }
 *
 * `caso` es la etiqueta de la rama que ganó ('Arrendar', 'sin coincidencia'…).
 * Se usa para la nota del lead: si un día los leads acaban donde no deben, hay
 * que poder leer en la ficha qué decidió el sistema, no adivinarlo.
 */
export function decidirDestino(reglas, body, base = {}) {
  const salida = {
    pipelineId: base.pipeline_id || null,
    assignedTo: base.assigned_to || null,
    tags: Array.isArray(base.tags) ? [...base.tags] : [],
    repartoClave: null,
    repartoEntre: null,
    caso: null,
  };

  const campo = reglas && typeof reglas === 'object' ? reglas.campo : null;
  if (!campo) return salida;

  // `campo` admite VARIOS nombres separados por coma. Una web no tiene un solo
  // formulario: en certainpezzano.com la ficha de inmueble usa `field_a74788e`
  // y el de contacto `field_a7e5788` —se distinguen en un carácter— y obligar a
  // una conexión por formulario es pedirle al cliente que mantenga las mismas
  // reglas en dos sitios. Gana el primero que venga en el envío.
  const nombres = String(campo).split(',').map(c => c.trim()).filter(Boolean);
  let valor = null;
  for (const n of nombres) {
    if (body && body[n] !== undefined && String(body[n]).trim() !== '') { valor = body[n]; break; }
  }
  const casos = Array.isArray(reglas.casos) ? reglas.casos : [];
  const ganador = casos.find(c => c && coincide(valor, c.vale)) || null;
  const rama = ganador || (reglas.sino && typeof reglas.sino === 'object' ? reglas.sino : null);

  salida.caso = ganador ? String(ganador.vale) : 'sin coincidencia';
  if (!rama) return salida;

  if (rama.pipeline_id) salida.pipelineId = rama.pipeline_id;
  if (Array.isArray(rama.tags) && rama.tags.length) {
    salida.tags = [...new Set([...salida.tags, ...rama.tags])];
  }

  const rep = rama.reparto;
  if (rep && rep.modo === 'fijo' && rep.quien) {
    salida.assignedTo = rep.quien;
  } else if (rep && rep.modo === 'turnos') {
    // El turno de esta rama es suyo: si arriendo y venta compartieran contador,
    // dos leads seguidos de arriendo se irían a dos personas distintas y el
    // reparto dejaría de ser parejo dentro de cada rama.
    salida.assignedTo = null;
    salida.repartoClave = 'conector:' + normaliza(ganador ? ganador.vale : 'sino').slice(0, 30);
    salida.repartoEntre = Array.isArray(rep.entre) && rep.entre.length ? rep.entre : null;
  }
  return salida;
}

/**
 * Elementor manda los campos anidados, y de DOS formas distintas según por
 * dónde entre. No es un detalle: sin esto el lead entra sin datos de contacto,
 * que es como si no hubiera llegado.
 *
 *   El navegador (el script f.js):  form_fields[name] = "Ana"
 *   El Webhook del servidor:        fields[name][id]        = "name"
 *                                   fields[name][type]      = "text"
 *                                   fields[name][value]     = "Ana"
 *                                   fields[name][raw_value] = "Ana"
 *                                   form[id] / form[name]   = el sobre
 *                                   meta[...]               = fecha, ip, página
 *
 * La trampa que costó un lead real: en la forma del Webhook el sobre trae
 * `form[name]`, que es el NOMBRE DEL FORMULARIO. Desanidando a lo bruto se
 * convertía en `name` y el lead se llamaba «form contacto» en vez de como la
 * persona. Por eso, cuando el envío es del Webhook, solo se leen los valores de
 * `fields[…]` y el sobre se ignora entero.
 */
export function desanidarCorchetes(body) {
  if (!body || typeof body !== 'object') return body;

  // ¿Es el Webhook de Elementor? Lo delata el doble corchete de `fields[x][y]`.
  if (Object.keys(body).some(k => /^fields\[[^\]]+\]\[/.test(k))) {
    const out = {};
    for (const [k, v] of Object.entries(body)) {
      const m = /^fields\[([^\]]+)\]\[(value|raw_value)\]$/.exec(k);
      // `value` manda; `raw_value` solo rellena si el otro no vino. Lo demás
      // —id, type, el sobre— no es dato de nadie y ensuciaba la nota entera.
      if (m && (m[2] === 'value' || out[m[1]] === undefined)) out[m[1]] = v;
    }
    // La página desde donde escribieron sí interesa: dice por qué inmueble
    // preguntan. Viaja en el sobre de meta, no entre los campos.
    const pagina = body['meta[page_url][value]'] || body['meta[page_url]'] || null;
    if (pagina) out.page_url = pagina;
    return out;
  }

  // Forma del navegador: se AÑADEN los alias sin quitar nada. Si la web manda a
  // la vez `email` y `form_fields[email]`, no queremos perder ninguno.
  const out = { ...body };
  for (const [k, v] of Object.entries(body)) {
    const m = /^[^\[\]]+\[([^\[\]]+)\]$/.exec(k);
    if (m && out[m[1]] === undefined) out[m[1]] = v;
  }
  return out;
}

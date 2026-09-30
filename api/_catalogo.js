// api/_catalogo.js
// El inventario del cliente, traído de su WordPress.
//
// Vive aquí y no dentro del endpoint porque lo usan dos: el botón «Sincronizar»
// de la pantalla y el cron que lo mantiene al día. Con dos copias, el lector de
// precios de una se arreglaría y el de la otra no, y nadie se enteraría hasta
// que un agente cantara un precio viejo.
//
// Por qué WordPress y no raspar HTML: certainpezzano.com expone /wp-json con un
// tipo 'propiedades' y taxonomías resueltas. Lo único que NO expone es el
// precio, que hay que leer de la ficha — y eso es lo que hace lenta la
// sincronización, así que va por lotes con un cursor.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export const UA = { 'User-Agent': 'Acuarius/1.0 (+https://acuarius.app)' };

// Cuántos inmuebles se miran por ejecución.
//
// Leer una ficha tarda ~2s, así que el tope lo pone cuántas hay que LEER, no
// cuántas se miran. Y desde que se saltan las que no han cambiado, en una
// pasada normal no hay casi ninguna que leer: la primera vuelta es la cara, las
// siguientes salen casi gratis. Por eso el lote sube a 40 y la concurrencia a
// 8: en el peor caso (todas nuevas) son ~10s, dentro del límite y sin castigar
// la web ajena.
const LOTE = 40;
const A_LA_VEZ = 8;

function sb() {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Prefer: 'return=representation',
  };
}

export const num = (v) => {
  const n = parseInt(String(v ?? '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};

// Ejecuta las tareas de A_LA_VEZ en A_LA_VEZ conservando el orden del resultado.
async function enTandas(items, fn) {
  const salida = new Array(items.length);
  let i = 0;
  async function obrero() {
    while (i < items.length) {
      const mio = i++;
      salida[mio] = await fn(items[mio], mio);
    }
  }
  await Promise.all(Array.from({ length: Math.min(A_LA_VEZ, items.length) }, obrero));
  return salida;
}

// ── Los precios ─────────────────────────────────────────────────────────────
// Antes se cogía el MAYOR importe creíble de la ficha. Parecía razonable —los
// menores suelen ser administración o cuotas— y era falso en el caso que más
// duele: una ficha que anuncia venta Y arriendo. Ahí el mayor es el de venta, y
// 30 de los 469 inmuebles de Certain guardaban el precio de venta donde iba el
// canon. No fallaba nada a la vista: esos 30 simplemente dejaban de aparecer en
// toda búsqueda de arriendo, porque el filtro comparaba un presupuesto de tres
// millones contra ochocientos.
//
// La ficha trae los importes ETIQUETADOS, así que se leen por su etiqueta.
const ETIQUETAS = [
  { campo: 'precio_arriendo', re: /arriend|alquil|canon|renta/i },
  { campo: 'precio_venta',    re: /venta/i },
  { campo: 'administracion',  re: /administraci/i },
];

export function preciosDeTexto(texto) {
  const out = {};
  // «Etiqueta: $ 2.716.000». La etiqueta se limita a letras para no arrastrar
  // media frase, y por eso de «Barranquilla Arriendo:» se queda con «Arriendo».
  for (const m of String(texto || '').matchAll(/([A-Za-zÁÉÍÓÚáéíóúÑñ]{4,20})\s*:\s*\$\s?([\d.,]{4,})/g)) {
    const valor = num(m[2]);
    if (!valor || valor < 100000 || valor >= 100000000000) continue;
    for (const { campo, re } of ETIQUETAS) {
      // La primera aparición manda: las fichas repiten el mismo dato en la
      // cabecera y en el detalle, y el de cabecera es el bueno.
      if (re.test(m[1]) && out[campo] == null) out[campo] = valor;
    }
  }
  return out;
}

export function textoDeFicha(html) {
  // Sin quitar las etiquetas HTML no hay nada que casar: «<span>Arriendo:</span>
  // <b>$2.716.000</b>» es lo normal en estas fichas.
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ');
}

// Cuántas fotos se guardan por inmueble. Cuatro: las que el cliente pidió
// enseñar, y unas pocas más no ayudan a decidir y sí llenan el chat.
const TOPE_FOTOS = 4;

// Las fotos del inmueble, de su propia ficha.
//
// Se reconocen porque el nombre del archivo lleva el código —
// «121514301_1_1776116684_1.jpg»—. Es una señal determinista: nunca se cuela la
// foto de otro inmueble, ni el logo, ni un icono. Si una ficha no las nombra
// así, se queda sin fotos y el agente lo dirá, que es el fallo correcto.
export function fotosDelHtml(html, codigo) {
  if (!codigo) return [];
  const vistas = [];
  for (const m of String(html || '').matchAll(/https?:\/\/[^"'\s)]+\.(?:jpg|jpeg|png|webp)/gi)) {
    const u = m[0];
    if (!u.includes(codigo)) continue;
    // WordPress publica la misma foto en varios tamaños («-768x576.jpg»). Se
    // queda la original: en WhatsApp se ve en grande.
    if (/-\d{2,4}x\d{2,4}\.(?:jpg|jpeg|png|webp)$/i.test(u)) continue;
    if (!vistas.includes(u)) vistas.push(u);
    if (vistas.length >= TOPE_FOTOS) break;
  }
  return vistas;
}

async function preciosDeFicha(url, codigo) {
  try {
    const html = await fetch(url, { headers: UA }).then(r => r.text());
    const fotos = fotosDelHtml(html, codigo);
    const texto = textoDeFicha(html);
    const p = { ...preciosDeTexto(texto), fotos };
    if (p.precio_arriendo || p.precio_venta) return p;

    // Ninguna etiqueta reconocible: se vuelve al método viejo para no dejar la
    // ficha sin precio, pero sin fingir que se sabe de qué operación es.
    const importes = [...texto.matchAll(/\$\s?([\d.,]{6,})/g)]
      .map(m => num(m[1]))
      .filter(n => n && n >= 200000 && n < 100000000000);
    return importes.length ? { ...p, precio_suelto: Math.max(...importes) } : p;
  } catch { return {}; }
}

// Qué va en la columna `precio`, que se lee desde hace un año y no se toca: el
// precio de la operación principal del inmueble.
export function precioPrincipal(operacion, p) {
  const op = String(operacion || '').toLowerCase();
  if (op.includes('arriend') || op.includes('alquil')) {
    return p.precio_arriendo ?? p.precio_suelto ?? p.precio_venta ?? null;
  }
  if (op.includes('venta')) return p.precio_venta ?? p.precio_suelto ?? p.precio_arriendo ?? null;
  return p.precio_arriendo ?? p.precio_venta ?? p.precio_suelto ?? null;
}

// Los términos de una taxonomía, por id. Paginado: algunas pasan de 100.
async function terminos(base, tax) {
  const mapa = new Map();
  for (let p = 1; p <= 10; p++) {
    const r = await fetch(`${base}/wp-json/wp/v2/${tax}?per_page=100&page=${p}`, { headers: UA });
    if (!r.ok) break;
    const lista = await r.json().catch(() => []);
    for (const t of lista) mapa.set(t.id, t.name);
    const total = parseInt(r.headers.get('x-wp-totalpages') || '1', 10) || 1;
    if (p >= total) break;
  }
  return mapa;
}

// ── Una pasada, un lote ─────────────────────────────────────────────────────
// Devuelve un objeto plano: quien llama decide si eso es una respuesta HTTP o
// una línea de registro del cron.
export async function sincronizarLote(fuente) {
  const { user_id: userId, client_id: clientId } = fuente;
  const base = fuente.base_url;
  if (!base) return { error: 'Esta fuente no tiene web: el inventario se cargó de un archivo.', estado: 400 };

  // Si el tamaño de lote cambió desde que empezó la pasada, la paginación ya no
  // apunta a lo mismo y hay que empezar de nuevo. Ver sql/2026-09-catalogo-lote-pasada.sql:
  // continuar dejó 82 inmuebles sin visitar, y 39 de ellos seguían publicados.
  const loteCambio = fuente.pase_lote != null && fuente.pase_lote !== LOTE;
  const pagina = loteCambio ? 1 : Math.max(1, fuente.cursor_pagina || 1);
  const tipo = fuente.post_type || 'propiedades';
  const mapeo = fuente.mapeo || {};
  const alcance = `user_id=eq.${encodeURIComponent(userId)}&` +
    (clientId ? `client_id=eq.${encodeURIComponent(clientId)}` : 'client_id=is.null');

  // Cuándo empezó la pasada en curso. Al terminarla se borra lo que no se haya
  // visto en ella, así que el corte se fija ANTES de leer nada: con la hora del
  // final, lo guardado en la primera página quedaría por detrás y se borraría.
  //
  // Y se normaliza a ISO con Z. Postgres lo devuelve como
  // «2026-09-28T22:25:27.202+00:00», y en una URL el «+» significa espacio: la
  // consulta de la barrida salía mal formada, fallaba, y la pasada terminaba
  // diciendo «no se pudo comprobar qué inmuebles siguen publicados». Nunca
  // borró nada y el aviso era tan educado que parecía un caso previsto.
  const paseDesde = (pagina === 1 || !fuente.pase_desde || loteCambio)
    ? new Date().toISOString()
    : new Date(fuente.pase_desde).toISOString();

  const anotar = (campos) => fetch(
    `${SUPABASE_URL}/rest/v1/client_knowledge_sources?id=eq.${fuente.id}`,
    { method: 'PATCH', headers: sb(), body: JSON.stringify(campos) }
  ).catch(() => {});

  // Orden por id ascendente, no por fecha de modificación.
  //
  // La pasada se hace de 30 en 30 a lo largo de varias ejecuciones. Con
  // «modified desc», cualquier inmueble que el cliente edite entre una página y
  // la siguiente salta al principio y desplaza a los demás: alguno se queda sin
  // visitar en toda la pasada. Antes eso solo significaba un precio viejo; con
  // la barrida significaría borrar un inmueble que sí existe. El id no se mueve.
  const listado = await fetch(
    `${base}/wp-json/wp/v2/${tipo}?per_page=${LOTE}&page=${pagina}&orderby=id&order=asc`,
    { headers: UA }
  ).catch(() => null);
  if (!listado || !listado.ok) {
    const porque = listado ? 'La web respondió ' + listado.status : 'No se pudo alcanzar la web';
    await anotar({ ultimo_estado: 'error', ultimo_error: porque, ultimo_sync: new Date().toISOString() });
    return { error: porque, estado: 502 };
  }
  const totalPaginas = parseInt(listado.headers.get('x-wp-totalpages') || '1', 10) || 1;
  const props = await listado.json().catch(() => []);

  // Solo se piden las taxonomías que el mapeo dice que sirven.
  const usadas = [...new Set(Object.values(mapeo).filter(Boolean))];
  const mapas = {};
  for (const t of usadas) mapas[t] = await terminos(base, t);
  const uno = (rol, p) => {
    const tax = mapeo[rol];
    if (!tax || !mapas[tax]) return null;
    return (p[tax] || []).map(id => mapas[tax].get(id)).filter(Boolean)[0] || null;
  };

  // ── Solo se releen las fichas que cambiaron ──────────────────────────────
  // El precio hay que sacarlo de la ficha, y eso es lo único lento: 444
  // inmuebles a ~2s son doce horas de reloj repartidas en pasadas de una hora.
  // Releerlas todas cada vuelta es trabajo tirado, porque casi ninguna cambia.
  //
  // WordPress dice cuándo se modificó cada una. Si la fecha es la misma que la
  // guardada Y ya tenemos sus precios separados, se reutiliza lo que hay y solo
  // se marca como vista. La primera vuelta sigue siendo cara; las siguientes
  // cuestan una consulta y cuatro fichas.
  const codigos = props
    .map(p => String(p.title?.rendered || '').replace(/<[^>]*>/g, '').trim())
    .filter(Boolean);
  const guardadas = new Map();
  if (codigos.length) {
    const lista = codigos.map(c => `"${c.replace(/"/g, '')}"`).join(',');
    const filas = await fetch(
      `${SUPABASE_URL}/rest/v1/client_properties?${alcance}&codigo=in.(${encodeURIComponent(lista)})` +
      '&select=codigo,modificado,precio,precio_arriendo,precio_venta,administracion,fotos',
      { headers: sb() }
    ).then(r => (r.ok ? r.json() : [])).catch(() => []);
    for (const f of filas || []) guardadas.set(f.codigo, f);
  }

  const sigueIgual = (codigo, modified) => {
    const g = guardadas.get(codigo);
    if (!g || !g.modificado || !modified) return null;
    if (new Date(g.modificado).getTime() !== new Date(modified).getTime()) return null;
    // Sin precios separados no sirve: es una fila de antes de que existieran y
    // hay que releerla aunque no haya cambiado.
    if (g.precio_arriendo == null && g.precio_venta == null) return null;
    // Y sin fotos, igual. Son de una vuelta anterior a que se guardaran, y
    // dándolas por buenas no se rellenarían NUNCA: la fila tiene precio, se
    // reutiliza, y se queda sin fotos para siempre.
    if (!g.fotos) return null;
    return g;
  };

  let releidas = 0;
  let reusadas = 0;
  const precios = await enTandas(props, async (p) => {
    const codigo = String(p.title?.rendered || '').replace(/<[^>]*>/g, '').trim();
    const igual = sigueIgual(codigo, p.modified);
    if (igual) {
      reusadas++;
      return {
        precio_arriendo: igual.precio_arriendo,
        precio_venta: igual.precio_venta,
        administracion: igual.administracion,
        precio_suelto: igual.precio,
        fotos: igual.fotos,
        reusado: true,
      };
    }
    releidas++;
    return preciosDeFicha(p.link, codigo);
  });

  const ahora = new Date().toISOString();
  const filas = [];
  props.forEach((p, idx) => {
    const codigo = String(p.title?.rendered || '').replace(/<[^>]*>/g, '').trim();
    if (!codigo) return;
    const operacion = uno('operacion', p);
    const pr = precios[idx] || {};
    filas.push({
      user_id: userId, client_id: clientId, codigo,
      operacion,
      tipo: uno('tipo', p),
      ciudad: uno('ciudad', p),
      barrio: uno('barrio', p),
      habitaciones: num(uno('habitaciones', p)),
      banos: num(uno('banos', p)),
      estrato: num(uno('estrato', p)),
      precio: precioPrincipal(operacion, pr),
      precio_arriendo: pr.precio_arriendo ?? null,
      precio_venta: pr.precio_venta ?? null,
      administracion: pr.administracion ?? null,
      fotos: pr.fotos?.length ? pr.fotos : null,
      url: p.link,
      modificado: p.modified ? new Date(p.modified).toISOString() : null,
      visto_en: ahora,
    });
  });

  // La web puede repetir el mismo código en dos fichas —en Certain pasa con 15
  // de 484— y Postgres no deja actualizar dos veces la misma fila en una sola
  // sentencia: fallaba el lote entero. Se queda la primera.
  const porCodigo = new Map();
  for (const f of filas) if (!porCodigo.has(f.codigo)) porCodigo.set(f.codigo, f);
  const unicas = [...porCodigo.values()];
  const repetidos = filas.length - unicas.length;

  if (unicas.length) {
    // on_conflict obligatorio: sin él el segundo guardado choca con el índice
    // único y da 409.
    const up = await fetch(`${SUPABASE_URL}/rest/v1/client_properties?on_conflict=user_id,client_id,codigo`, {
      method: 'POST',
      headers: { ...sb(), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(unicas),
    });
    if (!up.ok) {
      const det = await up.text().catch(() => '');
      await anotar({ ultimo_estado: 'error', ultimo_error: det.slice(0, 300), ultimo_sync: new Date().toISOString() });
      return { error: 'No se pudieron guardar las propiedades: ' + det.slice(0, 300), estado: 500 };
    }
  }

  const terminado = pagina >= totalPaginas;
  const siguiente = terminado ? 1 : pagina + 1;

  // ── La barrida ────────────────────────────────────────────────────────────
  // Al cerrar una pasada completa se borra lo que no se vio en ella: es lo que
  // el sitio ya no publica. Antes no se borraba nunca y el catálogo solo crecía
  // —Certain acumuló 25 inmuebles que ya no existen—, y los que se quitan de la
  // web son justo los que se acaban de arrendar.
  let barridos = null;
  let aviso = null;
  if (terminado) {
    const cuantos = async (filtro) => {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/client_properties?${alcance}&${filtro}&select=id`,
        { headers: { ...sb(), Prefer: 'count=exact', Range: '0-0' } }).catch(() => null);
      if (!r || !r.ok) return null;
      return parseInt((r.headers.get('content-range') || '').split('/')[1] || '', 10);
    };
    const sobran = await cuantos(`visto_en=lt.${paseDesde}`);
    const vivos = await cuantos(`visto_en=gte.${paseDesde}`);

    if (sobran == null || vivos == null) {
      aviso = 'No se pudo comprobar qué inmuebles siguen publicados, así que no se borró ninguno.';
      barridos = 0;
    } else if (sobran && sobran > (sobran + vivos) / 3) {
      // Borrar es lo único que no se deshace. Si la pasada dejaría fuera más de
      // un tercio del catálogo, lo normal no es que el cliente haya vaciado su
      // web: es que alguna página respondió mal. Se avisa y no se toca nada.
      aviso = `No se borró nada: la pasada dejaría fuera ${sobran} de ${sobran + vivos} inmuebles. ` +
        'Revisa que la web esté respondiendo bien y vuelve a sincronizar.';
      barridos = 0;
    } else if (sobran) {
      const del = await fetch(
        `${SUPABASE_URL}/rest/v1/client_properties?${alcance}&visto_en=lt.${paseDesde}`,
        { method: 'DELETE', headers: { ...sb(), Prefer: 'return=minimal' } }
      ).catch(() => null);
      barridos = del && del.ok ? sobran : 0;
      if (!del || !del.ok) aviso = 'No se pudieron borrar los inmuebles que ya no están publicados.';
    } else {
      barridos = 0;
    }
  }

  await anotar({
    cursor_pagina: siguiente,
    // Al cerrar la pasada se limpia el corte: la siguiente fija el suyo.
    pase_desde: terminado ? null : paseDesde,
    pase_lote: terminado ? null : LOTE,
    ultimo_sync: new Date().toISOString(),
    ultimo_estado: terminado ? 'ok' : 'en_curso',
    ultimo_error: aviso,
  });

  return {
    guardadas: unicas.length, releidas, reusadas, reiniciada: loteCambio,
    pagina, de: totalPaginas, terminado,
    sin_precio: unicas.filter(f => !f.precio).length,
    codigos_repetidos: repetidos,
    barridos, aviso,
  };
}

// Las fuentes que hay que mantener al día: las que leen de una web.
// Las que llevan más tiempo sin sincronizar, primero: si el cron no alcanza a
// todas, la próxima pasada empieza por las que se quedaron fuera. Antes el
// orden era fijo y las últimas no se actualizaban nunca (30-09-2026).
// Y un fallo LANZA: devolver [] hacía que el latido dijera «0 fuentes, todo
// bien» mientras ningún catálogo se actualizaba.
export async function fuentesConWeb() {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/client_knowledge_sources?activo=is.true&base_url=not.is.null&select=*&order=ultimo_sync.asc.nullsfirst,id.asc`,
    { headers: sb() }
  );
  if (!r.ok) throw new Error('no se pudieron leer las fuentes del catálogo (Supabase ' + r.status + ')');
  return (await r.json()) || [];
}

// api/_hoja-productos.js
// El catálogo de PRODUCTOS de un cliente, leído de una hoja de Google.
//
// Nació con AMETT (joyería, 14-10-2026): no tienen el inventario al día en la
// web y van a migrar a Shopify, así que la web no sirve de fuente. Una hoja de
// cálculo sí: la edita cualquiera del equipo desde el móvil y no hay que
// conectar cuentas. El cliente la comparte como «cualquier persona con el
// enlace» y aquí se lee su exportación CSV.
//
// Va aparte del catálogo de inmuebles (client_properties) a propósito: aquel
// filtra por operación, barrio y habitaciones, y una joya no tiene nada de eso.
// Meter un anillo en una tabla de inmuebles habría dejado al agente buscando
// «habitaciones» en un dije. Cuando lleguen a Shopify, Shopify será otro origen
// que llena ESTA misma tabla: el agente no cambia.
//
// Lo usan dos: el endpoint (botón «Sincronizar ahora») y cron-catalogo. Por eso
// vive aquí: con dos copias, el lector de precios de una se arreglaría y el de
// la otra no.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const LOTE = 400;
export const MAX_FILAS = 5000;

function sb() {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Prefer: 'return=representation',
  };
}

// El alcance de un catálogo: el de un cliente de agencia, o el de la cuenta
// entera (client_id NULL) para un negocio sin perfil, como AMETT hoy.
export function filtroAlcance(userId, clientId) {
  return `user_id=eq.${encodeURIComponent(userId)}` +
    (clientId ? `&client_id=eq.${encodeURIComponent(clientId)}` : '&client_id=is.null');
}

// ── La dirección de la hoja ─────────────────────────────────────────────────
// La gente pega lo que tiene en la barra del navegador: el enlace de edición
// (/d/<id>/edit#gid=123), el de compartir (/d/<id>/edit?usp=sharing) o el de
// «Publicar en la web» (/d/e/<id>/pubhtml). Los tres llevan a un CSV; la
// pestaña (gid) se respeta, porque la hoja puede tener una de reparaciones al
// lado y leer la equivocada daría un catálogo de servicios.
export function csvDeHoja(enlace) {
  const s = String(enlace || '').trim();
  let u;
  try { u = new URL(s); } catch { return { error: 'Pega el enlace completo de la hoja (empieza por https://docs.google.com/spreadsheets/…)' }; }
  if (u.hostname !== 'docs.google.com' || !u.pathname.startsWith('/spreadsheets/')) {
    return { error: 'Ese enlace no es de una hoja de Google. Ábrela en Google Sheets y copia la dirección de la barra del navegador.' };
  }
  const gid = (u.hash.match(/gid=(\d+)/) || [])[1] || u.searchParams.get('gid') || null;
  const publicada = u.pathname.match(/^\/spreadsheets\/d\/e\/([\w-]+)/);
  if (publicada) {
    return { csv: `https://docs.google.com/spreadsheets/d/e/${publicada[1]}/pub?output=csv${gid ? '&gid=' + gid : ''}` };
  }
  const normal = u.pathname.match(/^\/spreadsheets\/d\/([\w-]+)/);
  if (!normal) return { error: 'No se reconoce el enlace de la hoja. Copia la dirección completa desde la barra del navegador.' };
  return { csv: `https://docs.google.com/spreadsheets/d/${normal[1]}/export?format=csv${gid ? '&gid=' + gid : ''}` };
}

// ── CSV ─────────────────────────────────────────────────────────────────────
// Un CSV de verdad: comillas, separadores y saltos de línea dentro de una celda
// (una descripción de joya los trae), comillas escapadas duplicándolas. Es el
// mismo lector que kbParsearCSV en app.js, en el servidor.
export function parsearCSV(texto, sep = ',') {
  const filas = [];
  let campo = '', fila = [], enComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; }
        else enComillas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') { enComillas = true; continue; }
    if (c === sep) { fila.push(campo); campo = ''; continue; }
    if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; continue; }
    if (c === '\r') continue;
    campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const txt = (v, max = 200) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };

// Qué columna es qué, por el nombre de la cabecera. La plantilla trae estos
// nombres; las variantes cubren a quien ya tenía su propia hoja.
//
// El orden importa: «Color del oro» contiene «oro» y «Material» puede decir
// «oro»; se prueba primero la coincidencia exacta y luego la parcial, y cada
// columna se asigna una sola vez.
export const COLUMNAS = [
  { k: 'referencia', l: 'Referencia', pistas: ['referencia', 'ref', 'codigo', 'sku', 'cod'] },
  { k: 'nombre', l: 'Nombre', pistas: ['nombre', 'producto', 'pieza', 'titulo'] },
  { k: 'tipo', l: 'Tipo de joya', pistas: ['tipo de joya', 'tipo', 'categoria', 'clase'] },
  { k: 'coleccion', l: 'Colección', pistas: ['coleccion', 'linea'] },
  { k: 'material', l: 'Material', pistas: ['material', 'metal'] },
  { k: 'color_oro', l: 'Color del oro', pistas: ['color del oro', 'color oro', 'color'] },
  { k: 'gemas', l: 'Gemas', pistas: ['gemas', 'gema', 'piedras', 'piedra'] },
  { k: 'talla', l: 'Talla o medida', pistas: ['talla o medida', 'talla', 'medida', 'largo'] },
  { k: 'precio', l: 'Precio', pistas: ['precio', 'valor', 'pvp'] },
  { k: 'disponible', l: 'Disponible', pistas: ['disponible', 'disponibilidad', 'estado', 'stock'] },
  { k: 'unidades', l: 'Unidades', pistas: ['unidades', 'cantidad', 'existencias', 'inventario'] },
  { k: 'fotos', l: 'Foto', pistas: ['foto', 'fotos', 'imagen', 'imagenes'] },
  { k: 'url', l: 'Enlace', pistas: ['enlace', 'url', 'link', 'web'] },
  { k: 'descripcion', l: 'Descripción', pistas: ['descripcion', 'detalle', 'notas'] },
];

export function mapearCabecera(cabecera) {
  const cols = cabecera.map(norm);
  const mapa = {};
  const usada = new Set();
  for (const pasada of ['exacta', 'parcial']) {
    for (const c of COLUMNAS) {
      if (mapa[c.k] !== undefined) continue;
      const i = cols.findIndex((col, idx) => !usada.has(idx) && col &&
        c.pistas.some(p => (pasada === 'exacta' ? col === p : col.includes(p))));
      if (i >= 0) { mapa[c.k] = i; usada.add(i); }
    }
  }
  return mapa;
}

// «$ 1.235.440», «1,235,440», «1235440», «2.500.000,50». Se decide por la
// POSICIÓN del último separador: seguido de tres dígitos es de miles, de uno o
// dos es el decimal. Tratar solo el punto como miles convertía «1,235,440» en 1
// y el agente habría ofrecido un anillo por un peso (pasó con un inmueble).
export function precioDeCelda(v) {
  let s = String(v ?? '').replace(/[^\d,.]/g, '');
  if (!s) return null;
  const corte = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  if (corte === -1) { const n = parseInt(s, 10); return n > 0 ? n : null; }
  const cola = s.length - corte - 1;
  const esDecimal = cola > 0 && cola <= 2;
  const entera = (esDecimal ? s.slice(0, corte) : s).replace(/[.,]/g, '');
  const n = parseFloat(entera + (esDecimal ? '.' + s.slice(corte + 1) : ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

// «Sí», «no», «agotado», «vendido», «apartado». Vacío es «no lo dijeron», que
// NO es lo mismo que agotado: el agente lo ofrece con la disponibilidad por
// confirmar.
export function disponibleDeCelda(v) {
  const s = norm(v);
  if (!s) return null;
  if (/^(no|agotad|vendid|apartad|reservad|sin stock|0$)/.test(s)) return false;
  if (/^(si|disponible|en stock|hay|x$|ok$)/.test(s) || /^\d+$/.test(s)) return true;
  return null;
}

// Un enlace de Google Drive no es una imagen: es una página. Para mandarla por
// WhatsApp hace falta la dirección del archivo. Se aceptan varias fotos en una
// celda, separadas por espacio, coma, salto de línea o «|».
export function fotosDeCelda(v) {
  return String(v || '').split(/[\s,|]+/).map(x => x.trim()).filter(x => /^https?:\/\//i.test(x)).map(x => {
    const id = (x.match(/drive\.google\.com\/file\/d\/([\w-]+)/) || x.match(/drive\.google\.com\/(?:open|uc)\?(?:.*&)?id=([\w-]+)/) || [])[1];
    return id ? `https://lh3.googleusercontent.com/d/${id}` : x;
  }).slice(0, 6);
}

// Lee la hoja y la convierte en filas. No escribe nada: sirve también para
// comprobar el enlace ANTES de guardarlo.
export async function leerHoja(csvUrl) {
  let r;
  try {
    r = await fetch(csvUrl, { redirect: 'follow', headers: { 'User-Agent': 'Acuarius/1.0 (+https://acuarius.app)' } });
  } catch (e) {
    return { error: 'No se pudo abrir la hoja: ' + (e?.message || 'error de red') };
  }
  const tipo = r.headers.get('content-type') || '';
  // Una hoja privada no da 403: Google redirige a su pantalla de inicio de
  // sesión y responde 200 con HTML. Mirar solo el código la daría por buena y
  // el catálogo saldría con una fila de basura.
  if (r.status === 401 || r.status === 403 || tipo.includes('text/html') || /accounts\.google\.com/.test(r.url || '')) {
    return { error: 'La hoja no es pública. En Google Sheets: Compartir → Acceso general → «Cualquier persona con el enlace» (lector).', privada: true };
  }
  if (r.status === 404) return { error: 'Esa hoja no existe o la borraron. Revisa el enlace.' };
  if (!r.ok) return { error: `Google respondió ${r.status} al leer la hoja. Vuelve a intentarlo en unos minutos.` };

  let texto = await r.text();
  if (texto.charCodeAt(0) === 0xFEFF) texto = texto.slice(1);
  const bruto = parsearCSV(texto, ',').filter(f => f.some(c => String(c).trim() !== ''));
  if (bruto.length < 2) return { error: 'La hoja está vacía: necesita la fila de títulos y al menos un producto.' };

  const cabecera = bruto[0].map(c => String(c).trim());
  const mapa = mapearCabecera(cabecera);
  if (mapa.referencia === undefined) {
    return { error: 'Falta la columna «Referencia». Es la que identifica cada pieza entre una lectura y la siguiente.', cabecera };
  }
  if (bruto.length - 1 > MAX_FILAS) {
    return { error: `La hoja trae ${bruto.length - 1} filas y el máximo es ${MAX_FILAS}.` };
  }

  const celda = (f, k) => (mapa[k] !== undefined ? f[mapa[k]] : '');
  const porRef = new Map();
  let sinReferencia = 0, repetidas = 0, ejemplos = 0;
  for (const f of bruto.slice(1)) {
    const referencia = txt(celda(f, 'referencia'), 80);
    // Sin referencia no hay forma de reconocer la pieza en la siguiente
    // lectura: se cuenta y se dice, no se inventa una.
    if (!referencia) { sinReferencia++; continue; }
    // Las filas de ejemplo de la plantilla. Una plantilla que nadie limpió
    // pondría al agente a vender un solitario que no existe, con su precio.
    if (/^ejemplo/i.test(referencia)) { ejemplos++; continue; }
    if (porRef.has(referencia)) repetidas++;
    const unidades = mapa.unidades !== undefined && String(celda(f, 'unidades')).trim() !== ''
      ? parseInt(String(celda(f, 'unidades')).replace(/[^\d-]/g, ''), 10) : null;
    let disponible = disponibleDeCelda(celda(f, 'disponible'));
    // Las unidades mandan sobre la columna de texto: «Sí» con 0 unidades es un
    // descuido de quien actualizó una y no la otra, y ofrecer lo que no hay es
    // peor que preguntar.
    if (Number.isFinite(unidades)) disponible = unidades > 0;
    // La última fila con una referencia gana: es lo que se espera al corregir
    // abajo. Y Postgres no deja tocar dos veces la misma fila en un upsert.
    porRef.set(referencia, {
      referencia,
      nombre: txt(celda(f, 'nombre')),
      tipo: txt(celda(f, 'tipo'), 80),
      coleccion: txt(celda(f, 'coleccion'), 120),
      material: txt(celda(f, 'material'), 120),
      color_oro: txt(celda(f, 'color_oro'), 80),
      gemas: txt(celda(f, 'gemas')),
      talla: txt(celda(f, 'talla'), 80),
      precio: precioDeCelda(celda(f, 'precio')),
      disponible,
      unidades: Number.isFinite(unidades) ? Math.max(0, unidades) : null,
      fotos: fotosDeCelda(celda(f, 'fotos')),
      url: txt(celda(f, 'url'), 500),
      descripcion: txt(celda(f, 'descripcion'), 600),
    });
  }
  const filas = [...porRef.values()];
  if (!filas.length) {
    return { error: ejemplos
      ? 'La hoja solo tiene las filas de ejemplo de la plantilla. Agrega tus piezas (con su referencia) y vuelve a intentarlo.'
      : 'Ninguna fila trae referencia. Llena la columna «Referencia» de cada pieza.' };
  }
  return {
    filas,
    avisos: {
      sin_referencia: sinReferencia,
      repetidas,
      ejemplos,
      sin_precio: filas.filter(f => !f.precio).length,
      agotadas: filas.filter(f => f.disponible === false).length,
      // Columnas que la hoja NO trae: si falta «Precio», el agente no dará
      // ninguno, y eso hay que saberlo al conectar, no al primer cliente.
      faltan: COLUMNAS.filter(c => mapa[c.k] === undefined).map(c => c.l),
    },
  };
}

// Cuántos productos hay hoy guardados en ese alcance.
async function contar(userId, clientId) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/client_products?${filtroAlcance(userId, clientId)}&select=id`,
    { headers: { ...sb(), Prefer: 'count=exact', Range: '0-0' } });
  if (!r.ok) throw new Error('No se pudo contar el catálogo (HTTP ' + r.status + ')');
  return parseInt((r.headers.get('content-range') || '').split('/')[1] || '0', 10) || 0;
}

async function anotar(fuente, cambios) {
  await fetch(`${SUPABASE_URL}/rest/v1/client_product_sources?id=eq.${fuente.id}`, {
    method: 'PATCH', headers: { ...sb(), Prefer: 'return=minimal' }, body: JSON.stringify(cambios),
  }).catch(() => {});
}

// Lee la hoja y deja el catálogo IGUAL a ella: lo que está se crea o se
// actualiza, lo que se quitó de la hoja se borra (en una joyería, lo que se
// quita de la lista es lo que se vendió).
//
// Con un freno: si de golpe desaparecen dos tercios del catálogo, no se borra
// nada y se avisa. Una hoja a la que alguien le borró filas sin querer, o una
// pestaña cambiada, dejaría al agente diciendo «no tengo nada» a todo el mundo.
// Si fue a propósito, «Sincronizar ahora» lo confirma (forzar).
export async function sincronizarHoja(fuente, { forzar = false } = {}) {
  const inicio = new Date().toISOString();
  const leida = await leerHoja(fuente.csv_url);
  if (leida.error) {
    await anotar(fuente, { ultimo_sync: inicio, ultimo_estado: 'error', ultimo_error: leida.error });
    return { error: leida.error, estado: 400 };
  }

  const antes = await contar(fuente.user_id, fuente.client_id);
  if (!forzar && antes >= 9 && leida.filas.length < antes / 3) {
    const msg = `La hoja trae ${leida.filas.length} piezas y el catálogo tenía ${antes}. No se borró nada por si fue un error; ` +
      'si de verdad quitaste esas piezas, pulsa «Sincronizar ahora».';
    await anotar(fuente, { ultimo_sync: inicio, ultimo_estado: 'error', ultimo_error: msg });
    return { error: msg, estado: 409, freno: true };
  }

  const base = { user_id: fuente.user_id, client_id: fuente.client_id || null, visto_en: inicio };
  let guardadas = 0;
  for (let i = 0; i < leida.filas.length; i += LOTE) {
    const lote = leida.filas.slice(i, i + LOTE).map(f => ({ ...base, ...f }));
    const up = await fetch(`${SUPABASE_URL}/rest/v1/client_products?on_conflict=user_id,client_id,referencia`, {
      method: 'POST',
      headers: { ...sb(), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(lote),
    });
    if (!up.ok) {
      // Se dice cuántas SÍ entraron, y no se borra nada: con medio catálogo
      // escrito, barrer lo «no visto» se llevaría la otra mitad.
      const msg = `Se guardaron ${guardadas} piezas y falló a partir de ahí: ${(await up.text()).slice(0, 200)}`;
      await anotar(fuente, { ultimo_sync: inicio, ultimo_estado: 'error', ultimo_error: msg });
      return { error: msg, estado: 500, guardadas };
    }
    guardadas += lote.length;
  }

  const del = await fetch(
    `${SUPABASE_URL}/rest/v1/client_products?${filtroAlcance(fuente.user_id, fuente.client_id)}&visto_en=lt.${encodeURIComponent(inicio)}`,
    { method: 'DELETE', headers: { ...sb(), Prefer: 'return=representation' } });
  const quitadas = del.ok ? ((await del.json().catch(() => [])) || []).length : 0;
  if (!del.ok) {
    const msg = 'Se actualizaron las piezas pero no se pudieron quitar las que ya no están en la hoja (HTTP ' + del.status + ')';
    await anotar(fuente, { ultimo_sync: inicio, ultimo_estado: 'error', ultimo_error: msg, filas: guardadas, avisos: leida.avisos });
    return { error: msg, estado: 500, guardadas };
  }

  await anotar(fuente, { ultimo_sync: inicio, ultimo_estado: 'ok', ultimo_error: null, filas: guardadas, avisos: leida.avisos });
  return { ok: true, terminado: true, guardadas, quitadas, avisos: leida.avisos };
}

// Las hojas activas, la más atrasada primero: si al cron se le acaba el tiempo,
// las que queden van delante en la siguiente pasada.
export async function fuentesDeHoja() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/client_product_sources?activo=eq.true&select=*&order=ultimo_sync.asc.nullsfirst`, { headers: sb() });
  if (!r.ok) throw new Error('no se pudieron leer las hojas de productos (HTTP ' + r.status + ')');
  return r.json();
}

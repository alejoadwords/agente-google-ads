// api/_paginado.js — leer una colección entera de PostgREST, no los primeros mil.
//
// PostgREST está configurado con db-max-rows = 1000. Pidas lo que pidas,
// devuelve mil filas: sin error, sin cabecera de aviso y sin marca de que hay
// más. Una audiencia de 4.000 contactos salía a mil personas y la pantalla
// decía que la campaña se envió completa.
//
// Este módulo pagina hasta traerlo todo y, cuando choca con el techo de
// seguridad, lo DICE. Un corte que se ve es un problema; uno que se calla es
// una mentira que el cliente descubre meses después cruzando cifras.
//
// El guion bajo evita que Vercel lo publique como endpoint. Solo se importa
// desde funciones EDGE — desde una Node rompe el build (ver CLAUDE.md).

export const PAGINA = 1000; // el tope real del servidor; pedir más no sirve

/**
 * Trae todas las filas de una consulta de PostgREST.
 *
 * @param url      la consulta completa, con sus filtros y su `select`
 * @param headers  las cabeceras de Supabase
 * @param opciones techo: máximo de filas a traer antes de rendirse
 * @returns { filas, truncado, techo }  `truncado` es true si se llegó al techo
 *          y por tanto faltan filas. Quien llame TIENE que mirarlo.
 */
export async function traerTodo(url, headers, opciones = {}) {
  const techo = opciones.techo || 20000;
  const base = conOrdenEstable(sinPaginacion(url));
  const filas = [];

  for (let offset = 0; offset < techo; offset += PAGINA) {
    const pido = Math.min(PAGINA, techo - offset);
    const res = await fetch(`${base}&limit=${pido}&offset=${offset}`, { headers });
    if (!res.ok) {
      throw new Error(`PostgREST ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const lote = await res.json();
    if (!Array.isArray(lote)) break;
    for (const f of lote) filas.push(f);
    // Un lote incompleto significa que no hay más: ya está todo.
    if (lote.length < pido) return { filas, truncado: false, techo };
  }
  return { filas, truncado: true, techo };
}

// Quitamos el limit/offset que trajera la consulta original. Varios sitios
// pedían `limit=10000` creyendo que servía de algo; dejarlo puesto y añadir
// otro produce una URL con dos limit, y gana el primero.
function sinPaginacion(url) {
  return String(url)
    .replace(/([?&])limit=\d+/gi, '$1')
    .replace(/([?&])offset=\d+/gi, '$1')
    .replace(/&{2,}/g, '&')
    .replace(/[?&]$/, '');
}

// Paginar con offset sobre un orden que no distingue filas devuelve duplicados
// y se salta otras: dos leads con la misma `stage_position` pueden cambiar de
// sitio entre una página y la siguiente. El id de desempate lo vuelve estable.
function conOrdenEstable(url) {
  const m = /([?&])order=([^&]*)/i.exec(url);
  if (!m) return url + (url.includes('?') ? '&' : '?') + 'order=id.asc';
  const orden = decodeURIComponent(m[2]);
  if (/\bid\b/.test(orden)) return url;
  return url.replace(m[0], `${m[1]}order=${encodeURIComponent(orden + ',id.asc')}`);
}

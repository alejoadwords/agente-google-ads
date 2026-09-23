// api/_pedir.js — una consulta que falla tiene que fallar
//
// El patrón que había repartido por los crons:
//
//   const cosas = await fetch(url, { headers })
//     .then(r => (r.ok ? r.json() : []))
//     .catch(() => []);
//   if (!cosas.length) return ok();   // «no hay nada que hacer»
//
// Convierte CUALQUIER fallo —un 504 de Supabase, un socket caído, una
// respuesta que no es JSON— en una lista vacía, y la línea siguiente la lee
// como «hoy no había nada». El cron devuelve 200, nadie se entera, y lo que
// tenía que salir no sale.
//
// No es teórico: el 23-09-2026 el resumen diario de tareas no le llegó a los
// cinco asesores de Certain Pezzano por exactamente esto, y no quedó ni un
// rastro que permitiera saber qué había pasado. Lo descubrió el cliente.
//
// `pedirLista` hace lo mismo pero deja que el fallo sea un fallo. Quien la
// llama decide qué hacer con él —anotarlo, devolver 500, reintentar— pero ya
// no puede confundirlo con «no hay nada».

/**
 * Trae una lista de PostgREST. Lanza si no se pudo.
 * @param {string} url      la consulta entera
 * @param {object} headers  cabeceras de Supabase
 * @param {string} que      qué se estaba pidiendo, para el mensaje de error
 * @returns {Promise<Array>}
 */
export async function pedirLista(url, headers, que = 'la consulta') {
  let r;
  try {
    r = await fetch(url, { headers });
  } catch (e) {
    throw new Error(`${que}: no se pudo contactar con la base (${e?.message || e})`);
  }
  if (!r.ok) {
    let cuerpo = '';
    try { cuerpo = (await r.text()).slice(0, 160); } catch {}
    throw new Error(`${que}: Supabase ${r.status} ${cuerpo}`);
  }
  let datos;
  try { datos = await r.json(); } catch (e) {
    throw new Error(`${que}: la respuesta no era JSON (${e?.message || e})`);
  }
  // PostgREST devuelve un objeto cuando hay error de esquema, no una lista.
  // Sin esta comprobación, `.length` sobre ese objeto da undefined y vuelve a
  // parecer «no hay nada».
  if (!Array.isArray(datos)) {
    throw new Error(`${que}: la respuesta no es una lista (${JSON.stringify(datos).slice(0, 160)})`);
  }
  return datos;
}

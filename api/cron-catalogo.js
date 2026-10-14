// api/cron-catalogo.js
// Mantiene al día el inventario que el agente ofrece.
//
// Existía el botón «Sincronizar» y no existía nada que lo pulsara. El catálogo
// de Certain se cargó el 13 de agosto de 2026 y ahí se quedó: 46 días después
// el agente seguía ofreciendo los precios de agosto y 25 inmuebles que ya no
// estaban publicados. En una inmobiliaria de arriendos, lo que se quita de la
// web es justo lo que se acaba de arrendar.
//
// Cada ejecución avanza un lote por fuente. Lo lento es leer la ficha de cada
// inmueble para sacarle el precio, pero eso solo se hace con los que cambiaron:
// la primera vuelta es la cara y las siguientes salen casi gratis. Con lotes de
// 40 y dos pasadas por hora, un catálogo de 450 inmuebles se recorre entero
// cada seis horas sin pedirle nada raro a la web del cliente.
//
// Al cerrar la vuelta, _catalogo.js borra lo que no vio. Por eso el cron no
// puede saltarse fuentes en silencio: si una web falla, se anota en la fuente y
// se sigue con la siguiente, pero la pasada NO se da por terminada.
export const config = { runtime: 'edge' };

import { fuentesConWeb, sincronizarLote } from './_catalogo.js';
import { fuentesDeHoja, sincronizarHoja } from './_hoja-productos.js';
import { latir } from './_latido.js';

const CRON_SECRET = process.env.CRON_SECRET;
// Edge: 25 s. Un lote de una fuente tarda hasta ~10 s (lee fichas de una web
// ajena), así que no se empieza uno nuevo pasados 12 s. Las que queden van
// primero en la siguiente pasada (fuentesConWeb ordena por ultimo_sync).
export const TOPE_MS = 12 * 1000;

export default async function handler(req) {
  if (req.headers.get('authorization') !== `Bearer ${CRON_SECRET}`) {
    return new Response('No autorizado', { status: 401 });
  }

  // El latido de entrada va antes de nada: si la función se cae a la mitad,
  // cron-errores tiene que poder decir que esta sí arrancó.
  await latir('cron-catalogo', { empezo: new Date().toISOString() });

  let fuentes;
  try {
    fuentes = await fuentesConWeb();
  } catch (e) {
    await latir('cron-catalogo', { error: true }, e?.message || String(e));
    return new Response(JSON.stringify({ error: e?.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  const hasta = Date.now() + (Number(process.env.CATALOGO_TOPE_MS) || TOPE_MS);   // la variable solo existe en la prueba
  const resumen = [];
  let fallos = 0;
  let barridosTotal = 0;
  let sinTiempo = 0;
  for (const f of fuentes) {
    if (Date.now() >= hasta) { sinTiempo++; continue; }
    try {
      const r = await sincronizarLote(f);
      if (r.error) fallos++;
      barridosTotal += r.barridos || 0;
      resumen.push({
        cliente: f.client_id || '(cuenta)',
        ...(r.error
          ? { error: r.error }
          : { guardadas: r.guardadas, releidas: r.releidas, reusadas: r.reusadas,
              pagina: r.pagina, de: r.de, terminado: r.terminado, barridos: r.barridos, aviso: r.aviso }),
      });
    } catch (e) {
      // Que la web de un cliente se caiga no puede dejar sin sincronizar a los
      // demás: son webs ajenas y se caen.
      fallos++;
      resumen.push({ cliente: f.client_id || '(cuenta)', error: e?.message || 'error desconocido' });
    }
  }

  // Las hojas de productos (joyería y demás), después de las webs. Leer una
  // hoja es una sola petición, así que caben casi siempre; las que no, van
  // primero la próxima vez (fuentesDeHoja ordena por ultimo_sync). Que no se
  // puedan listar NO tumba lo de las webs, que ya está hecho: se cuenta como
  // fallo y se dice en el latido.
  let hojas = [];
  let errorHojas = null;
  try { hojas = await fuentesDeHoja(); } catch (e) { errorHojas = e?.message || String(e); fallos++; }
  for (const h of hojas) {
    if (Date.now() >= hasta) { sinTiempo++; continue; }
    try {
      const r = await sincronizarHoja(h);
      if (r.error) fallos++;
      resumen.push({ hoja: h.client_id || '(cuenta)', ...(r.error ? { error: r.error } : { guardadas: r.guardadas, quitadas: r.quitadas }) });
    } catch (e) {
      fallos++;
      resumen.push({ hoja: h.client_id || '(cuenta)', error: e?.message || 'error desconocido' });
    }
  }

  await latir('cron-catalogo', { fuentes: fuentes.length, hojas: hojas.length, fallos, barridos: barridosTotal, sinTiempo },
    errorHojas ? 'no se pudieron leer las hojas de productos: ' + errorHojas
      : sinTiempo ? sinTiempo + ' fuente(s) quedan para la próxima pasada' : null);

  return new Response(JSON.stringify({ fuentes: fuentes.length, hojas: hojas.length, fallos, sinTiempo, resumen }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

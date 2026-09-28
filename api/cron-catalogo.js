// api/cron-catalogo.js
// Mantiene al día el inventario que el agente ofrece.
//
// Existía el botón «Sincronizar» y no existía nada que lo pulsara. El catálogo
// de Certain se cargó el 13 de agosto de 2026 y ahí se quedó: 46 días después
// el agente seguía ofreciendo los precios de agosto y 25 inmuebles que ya no
// estaban publicados. En una inmobiliaria de arriendos, lo que se quita de la
// web es justo lo que se acaba de arrendar.
//
// Va de 30 en 30 porque el precio hay que leerlo de cada ficha y eso tarda
// ~2s. Cada ejecución avanza un lote por fuente, así que un catálogo de 450
// inmuebles da una vuelta completa en unas quince horas. Suficiente: el
// objetivo es que no envejezca, no que sea instantáneo.
//
// Al cerrar la vuelta, _catalogo.js borra lo que no vio. Por eso el cron no
// puede saltarse fuentes en silencio: si una web falla, se anota en la fuente y
// se sigue con la siguiente, pero la pasada NO se da por terminada.
export const config = { runtime: 'edge' };

import { fuentesConWeb, sincronizarLote } from './_catalogo.js';
import { latir } from './_latido.js';

const CRON_SECRET = process.env.CRON_SECRET;

export default async function handler(req) {
  if (req.headers.get('authorization') !== `Bearer ${CRON_SECRET}`) {
    return new Response('No autorizado', { status: 401 });
  }

  // El latido de entrada va antes de nada: si la función se cae a la mitad,
  // cron-errores tiene que poder decir que esta sí arrancó.
  await latir('cron-catalogo', { empezo: new Date().toISOString() });

  const fuentes = await fuentesConWeb();
  const resumen = [];
  let fallos = 0;
  let barridosTotal = 0;
  for (const f of fuentes) {
    try {
      const r = await sincronizarLote(f);
      if (r.error) fallos++;
      barridosTotal += r.barridos || 0;
      resumen.push({
        cliente: f.client_id || '(cuenta)',
        ...(r.error
          ? { error: r.error }
          : { guardadas: r.guardadas, pagina: r.pagina, de: r.de, terminado: r.terminado, barridos: r.barridos, aviso: r.aviso }),
      });
    } catch (e) {
      // Que la web de un cliente se caiga no puede dejar sin sincronizar a los
      // demás: son webs ajenas y se caen.
      fallos++;
      resumen.push({ cliente: f.client_id || '(cuenta)', error: e?.message || 'error desconocido' });
    }
  }

  await latir('cron-catalogo', { fuentes: fuentes.length, fallos, barridos: barridosTotal });

  return new Response(JSON.stringify({ fuentes: fuentes.length, fallos, resumen }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// Mutaciones de pruebas/integridad-sin-recorte.mjs — node tools/mutar.mjs pruebas/mutaciones/integridad-sin-recorte.mjs

export const SUITE = 'pruebas/integridad-sin-recorte.mjs';
export const ARCHIVOS = { cron: 'api/cron-integridad.js' };
const cambiar = (de, a) => (s) => s.replace(de, a);

export const MUTACIONES = [
  { nombre: 'una sola página', archivo: 'cron', romper: cambiar("    if (lote.length < pagina) return filas;", "    return filas;") },
  { nombre: 'la paginación no avanza', archivo: 'cron', romper: cambiar("&offset=${desde}", "&offset=0") },
  { nombre: 'un fallo vuelve a ser lista vacía', archivo: 'cron', romper: cambiar("    if (!r.ok) throw new Error('HTTP ' + r.status + ' leyendo ' + ruta.split('?')[0]);", "    if (!r.ok) return filas;") },
  { nombre: 'la revisión de fantasmas calla el fallo', archivo: 'cron', romper: cambiar("  } catch (e) { return noSePudo('tareas fantasma', e); }", "  } catch (e) { return null; }") },
  { nombre: 'la de clientes vuelve a leer mil leads', archivo: 'cron', romper: cambiar("      sbTodas('activities?type=eq.task&done=is.false&cancelled_at=is.null&select=id,title,lead_id,client_id'),", "      sb('activities?type=eq.task&done=is.false&cancelled_at=is.null&select=id,title,lead_id,client_id&limit=1000'),") },
];

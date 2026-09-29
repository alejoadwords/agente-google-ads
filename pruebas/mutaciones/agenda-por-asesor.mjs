// Mutaciones de pruebas/agenda-por-asesor.mjs — node tools/mutar.mjs pruebas/mutaciones/agenda-por-asesor.mjs

export const SUITE = 'pruebas/agenda-por-asesor.mjs';
export const ARCHIVOS = { agenda: 'api/agenda.js', app: 'public/app.js' };
const cambiar = (de, a) => (s) => s.replace(de, a);

export const MUTACIONES = [
  // El corte
  { nombre: 'vuelve el tope de una sola página', archivo: 'agenda', romper: cambiar("    if (lote.length < pagina) return { filas, truncado: false };", "    return { filas, truncado: false };") },
  { nombre: 'la paginación no avanza', archivo: 'agenda', romper: cambiar("&offset=${desde}", "&offset=0") },
  { nombre: 'el techo se calla', archivo: 'agenda', romper: cambiar("  return { filas, truncado: true };", "  return { filas, truncado: false };") },
  { nombre: 'orden sin desempate', archivo: 'agenda', romper: cambiar("&select=*&order=due_at.asc,id.asc`;\n    if (from)", "&select=*&order=due_at.asc`;\n    if (from)") },
  { nombre: 'un fallo de la base se pinta como mes vacío', archivo: 'agenda', romper: cambiar("    if (fallo) return jsonResp({ error: 'No se pudo leer la agenda (' + fallo + '). Reintenta en unos segundos.' }, 502);\n", '') },
  { nombre: 'las tareas vuelven a un tope de 400', archivo: 'agenda', romper: cambiar("const { filas: tareas, fallo, truncado } = await todasLasFilas(q);", "const { filas: tareas, fallo, truncado } = await todasLasFilas(q, { pagina: 400, techo: 400 });") },
  // El asesor
  { nombre: 'los leads en una sola tanda', archivo: 'agenda', romper: cambiar("i += 150) {\n    const tanda = unicos.slice(i, i + 150);", "i += 100000) {\n    const tanda = unicos.slice(i, i + 100000);") },
  { nombre: 'el nombre con tabulador', archivo: 'agenda', romper: cambiar(".replace(/\\s+/g, ' ').trim();", ".trim();") },
  { nombre: 'Ventas ve lo de sus compañeras', archivo: 'agenda', romper: cambiar("    if (forzarMias) filas = soloDeMisLeads(filas, yoSoy);", "") },
  // La pantalla
  { nombre: 'cuenta también los días de otro mes', archivo: 'app', romper: cambiar("    if (d.getFullYear() !== y || d.getMonth() !== m) continue;\n", '') },
  { nombre: 'el desplegable sale con una sola persona', archivo: 'app', romper: cambiar("  if (gente.length < 2 && !elegido) return '';\n  const total", "  if (!gente.length && !elegido) return '';\n  const total") },
  { nombre: 'la opción elegida no se marca', archivo: 'app', romper: cambiar("        (elegido === p.id ? ' selected' : '') + '>' + esc(p.nombre) + ' (' + p.total", "        '' + '>' + esc(p.nombre) + ' (' + p.total") },
  { nombre: 'agnLoad no mira ok', archivo: 'app', romper: cambiar("    if (!res.ok) throw new Error(d.error || ('HTTP ' + res.status));\n    agnActivities", "    agnActivities") },
  { nombre: 'el choque vuelve a desde/hasta', archivo: 'app', romper: cambiar("    const r = await fetchAuth('/api/agenda?from=' + encodeURIComponent(dia0.toISOString()) +\n      '&to='", "    const r = await fetchAuth('/api/agenda?desde=' + encodeURIComponent(dia0.toISOString()) +\n      '&hasta='") },
  { nombre: 'el choque cuenta a todo el equipo', archivo: 'app', romper: cambiar("      if (a.type !== 'meeting' || (a.asesor_id || null) !== suAsesor) return false;\n", '') },
];

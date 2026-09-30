// Mutaciones de pruebas/escala-tres-primeros.mjs — node tools/mutar.mjs pruebas/mutaciones/escala-tres-primeros.mjs

export const SUITE = 'pruebas/escala-tres-primeros.mjs';
export const ARCHIVOS = { motor: 'api/cron-automations.js', app: 'public/app.js', soporte: 'api/soporte.js' };
const cambiar = (de, a) => (s) => s.replace(de, a);

export const MUTACIONES = [
  { nombre: 'vuelven a entrar los que ya tienen trabajo', archivo: 'motor', romper: cambiar("      if (yaTienen.has(l.id) || CERRADAS", "      if (CERRADAS") },
  { nombre: 'solo la primera página de leads', archivo: 'motor', romper: cambiar("    if (pagina.length < 1000) break;\n  }\n  if (!nuevos.length) return [];", "    break;\n  }\n  if (!nuevos.length) return [];") },
  { nombre: 'se ignora la tarea agendada', archivo: 'motor', romper: cambiar("  return nuevos.filter(l => !conSeguimiento.has(l.id));", "  return nuevos;") },
  { nombre: 'se ignora el reloj', archivo: 'motor', romper: cambiar("nuevos.length < NUEVOS_POR_AUTOMATIZACION && Date.now() < hasta;", "nuevos.length < NUEVOS_POR_AUTOMATIZACION;") },
  { nombre: 'sin tope de tiempo para la fase', archivo: 'motor', romper: cambiar("    if (Date.now() >= hasta) { sinTiempo++; continue; }", "") },
  { nombre: 'los ya encolados solo de la primera página', archivo: 'motor', romper: cambiar("    if (lote.length < 1000) return filas;\n  }\n  return filas;\n}\n\n// Leads inactivos", "    return filas;\n  }\n  return filas;\n}\n\n// Leads inactivos") },
  { nombre: 'la voz vuelve a preguntar siempre', archivo: 'app', romper: cambiar("  if (_vozEstado !== null || Date.now() < _vozReintentoDesde) return;", "") },
  { nombre: 'la voz reintenta sin espera', archivo: 'app', romper: cambiar("    _vozReintentoDesde = Date.now() + 5 * 60 * 1000;", "    _vozReintentoDesde = 0;") },
  { nombre: 'el GET de soporte vuelve a llamar a Clerk', archivo: 'soporte', romper: cambiar("    const actorId = payload.sub;\n", "    const actorId = payload.sub;\n    await correoDe(actorId, payload);\n") },
];

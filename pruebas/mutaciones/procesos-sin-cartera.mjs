// Mutaciones de pruebas/procesos-sin-cartera.mjs — node tools/mutar.mjs pruebas/mutaciones/procesos-sin-cartera.mjs

export const SUITE = 'pruebas/procesos-sin-cartera.mjs';
export const ARCHIVOS = { app: 'public/app.js', leads: 'api/leads.js' };
const cambiar = (de, a) => (s) => s.replace(de, a);

export const MUTACIONES = [
  { nombre: 'vuelve la vista global para toda cuenta sin cliente', archivo: 'app', romper: cambiar("  return !crmAmbitoCliente() && !crmCuentaSinCartera();", "  return !crmAmbitoCliente();") },
  { nombre: 'una Pro espera a la cartera para saberse sin cartera', archivo: 'app', romper: cambiar("  if (typeof esCuentaAgencia === 'function' && !esCuentaAgencia()) return true;\n", '') },
  { nombre: 'el selector esconde el nombre con un proceso', archivo: 'app', romper: cambiar("  sel.style.display = crmPipelines.length ? 'inline-flex' : 'none';", "  sel.style.display = crmPipelines.length > 1 ? 'inline-flex' : 'none';") },
  { nombre: 'sin procesos se esconde el engranaje', archivo: 'app', romper: cambiar("  cont.style.display = 'flex';\n  sel.style.display", "  cont.style.display = crmPipelines.length ? 'flex' : 'none';\n  sel.style.display") },
  { nombre: 'una cuenta sin cartera no puede crear', archivo: 'app', romper: cambiar("  const puede = !!cliente || sinCartera;", "  const puede = !!cliente;") },
  { nombre: 'pipeCrear vuelve a exigir cliente', archivo: 'app', romper: cambiar("  if (!pipeAmbitoNombre() && !crmCuentaSinCartera()) {", "  if (!pipeAmbitoNombre()) {") },
  { nombre: 'el tablero sin cartera no filtra por proceso', archivo: 'app', romper: cambiar("if (crmPipelineId && (clientId || sinCartera)) params.push", "if (crmPipelineId && clientId) params.push") },
  { nombre: 'el principal esconde los leads sin proceso', archivo: 'app', romper: cambiar(".is_default) params.push('con_sueltos=1');", ".is_default) params.push('x=1');") },
  { nombre: 'una Pro vuelve a ver el selector de cliente', archivo: 'app', romper: cambiar("  const isAgency = esCuentaAgencia() &&\n", "  const isAgency = true &&\n") },
  { nombre: 'una Pro puede salir a Mi cuenta', archivo: 'app', romper: cambiar("  if (!esCuentaAgencia()) return;\n  if (!id) {", "  if (!id) {") },
];

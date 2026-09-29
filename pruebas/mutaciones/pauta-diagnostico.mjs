// Mutaciones de pruebas/pauta-diagnostico.mjs — node tools/mutar.mjs pruebas/mutaciones/pauta-diagnostico.mjs

export const SUITE = 'pruebas/pauta-diagnostico.mjs';
export const ARCHIVOS = { reglas: 'api/_diagnostico-pauta.js', pauta: 'api/pauta.js', app: 'public/app.js' };
const cambiar = (de, a) => (s) => s.replace(de, a);

export const MUTACIONES = [
  // Reglas
  { nombre: 'una pausada cuenta como parada', archivo: 'reglas', romper: cambiar("if (activa(c.estado) && u7 && Number(u7.impresiones || 0) === 0 && !recien) {", "if (u7 && Number(u7.impresiones || 0) === 0 && !recien) {") },
  { nombre: 'una recién creada cuenta como parada', archivo: 'reglas', romper: cambiar("&& !recien) {", ") {") },
  { nombre: 'la cuenta bloqueada no se avisa', archivo: 'reglas', romper: cambiar("if (c.red === 'meta' && c.estado_meta != null && Number(c.estado_meta) !== 1) {", "if (false) {") },
  { nombre: 'gasto sin leads con poco gasto', archivo: 'reglas', romper: cambiar("? c.inversion >= umbralGasto :", "? c.inversion > 0 :") },
  { nombre: 'gasto sin leads ignora las conversiones de la red', archivo: 'reglas', romper: cambiar("if (leadsCrm === 0 && !Number(c.conv || 0) && gastoSuficiente) {", "if (leadsCrm === 0 && gastoSuficiente) {") },
  { nombre: 'se ofrece pausar lo ya pausado', archivo: 'reglas', romper: cambiar("accion: activa(c.estado) ? { tipo: 'pausar'", "accion: true ? { tipo: 'pausar'") },
  { nombre: 'el CPL alto no se detecta', archivo: 'reglas', romper: cambiar("c.cpl_real > cplMedio * U.cplAltoVeces", "c.cpl_real > cplMedio * 99") },
  { nombre: 'lo que funciona no se dice', archivo: 'reglas', romper: cambiar("c.cpl_real < cplMedio * U.cplBuenoVeces", "c.cpl_real < 0") },
  { nombre: 'el CTR se juzga también en Google', archivo: 'reglas', romper: cambiar("if (c.red === 'meta' && c.impresiones >= U.minImpresionesCtr) {", "if (c.impresiones >= U.minImpresionesCtr) {") },
  { nombre: 'la frecuencia no se mira', archivo: 'reglas', romper: cambiar("Number(u7.frecuencia || 0) > U.frecuenciaAlta", "false") },
  { nombre: 'los leads cerrados cuentan como sin atender', archivo: 'reglas', romper: cambiar("if (!l.campana_clave || cerrado(l)) continue;", "if (!l.campana_clave) continue;") },
  { nombre: 'los leads casan solo por id', archivo: 'reglas', romper: cambiar("(c.claves || ['id:' + c.id])", "['id:' + c.id]") },
  { nombre: 'los errores no van primero', archivo: 'reglas', romper: cambiar("const tipoPeso = { error: 0, oportunidad: 1, bien: 2 };", "const tipoPeso = { error: 1, oportunidad: 0, bien: 2 };") },
  { nombre: 'el objetivo de la campaña no se mira', archivo: 'reglas', romper: cambiar("const buscaLeads = !(c.red === 'meta' && OBJETIVOS_SIN_LEADS.has(String(c.objetivo || '').toUpperCase()));", "const buscaLeads = true;") },
  // Servidor
  { nombre: 'las activas sin datos no se añaden', archivo: 'pauta', romper: cambiar("      if (vistas.has(r + ':' + a.id)) continue;", "      continue;") },
  { nombre: 'pausar no comprueba la cuenta', archivo: 'pauta', romper: cambiar("if (c.error || String(c.account_id || '') !== act) {", "if (c.error) {") },
  // (Ventas no entra a Marketing: lo frena exigeModulo antes de llegar aquí, así
  // que quitar el chequeo interno no es un mutante que la prueba pueda ver.)
  { nombre: 'pausar manda otro estado', archivo: 'pauta', romper: cambiar("body: JSON.stringify({ status: 'PAUSED', access_token: fila.access_token }),", "body: JSON.stringify({ status: 'ACTIVE', access_token: fila.access_token }),") },
  { nombre: 'el id de la campaña no se limpia', archivo: 'pauta', romper: cambiar("const campanaId = String(body.campana_id || '').replace(/\\D/g, '');", "const campanaId = String(body.campana_id || '');") },
  { nombre: 'en Google se tocan más campos', archivo: 'pauta', romper: cambiar("status: 'PAUSED' }, updateMask: 'status' }]", "status: 'PAUSED' }, updateMask: 'status,name' }]") },
  // Pantalla
  { nombre: 'una cuenta caída se calla', archivo: 'app', romper: cambiar("    caidas.map(x => '<div class=\"pauta-aviso pauta-aviso-mal\">'", "    [].map(x => '<div class=\"pauta-aviso pauta-aviso-mal\">'") },
  { nombre: 'con una cuenta caída se dice «todo en orden»', archivo: 'app', romper: cambiar("(!hs.length && !caidas.length", "(!hs.length") },
  { nombre: 'el botón sale sin permiso', archivo: 'app', romper: cambiar("h.accion.tipo === 'pausar' && d.puede_pausar", "h.accion.tipo === 'pausar'") },
];

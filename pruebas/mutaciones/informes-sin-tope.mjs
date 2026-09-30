// Mutaciones de pruebas/informes-sin-tope.mjs — node tools/mutar.mjs pruebas/mutaciones/informes-sin-tope.mjs

export const SUITE = 'pruebas/informes-sin-tope.mjs';
export const ARCHIVOS = {
  conv: 'api/chat-conversations.js', act: 'api/lead-activities.js', nps: 'api/nps.js',
  pipe: 'api/pipelines.js', admin: 'api/admin.js', intake: 'api/_lead-intake.js',
};
const cambiar = (de, a) => (s) => s.replace(de, a);

export const MUTACIONES = [
  { nombre: 'conversaciones: techo de mil', archivo: 'conv', romper: cambiar('const TECHO_INFORME = 20000;', 'const TECHO_INFORME = 1000;') },
  { nombre: 'conversaciones: solo el primer lote de tiempos', archivo: 'conv', romper: cambiar('for (let i = 0; i < lotes.length; i += 4) {', 'for (let i = 0; i < 1; i += 4) {') },
  { nombre: 'conversaciones: total = mensajes enviados', archivo: 'conv', romper: cambiar('totalMensajes += x.mensajes || 0;', 'totalMensajes += 2;') },
  { nombre: 'conversaciones: fallo como vacío', archivo: 'conv', romper: cambiar("return jsonResp({ error: 'No se pudo armar el informe de conversaciones. Intenta de nuevo en un momento.' }, 502);", 'return jsonResp({ conversations: [], messages: [], channels: [] });') },
  { nombre: 'conversaciones: fallo del RPC se traga', archivo: 'conv', romper: cambiar("if (!r.ok) throw new Error(`informe_conversaciones", "if (!r.ok) return []; if (0) throw new Error(`informe_conversaciones") },
  { nombre: 'actividades: techo de mil', archivo: 'act', romper: cambiar('{ techo: 50000 }', '{ techo: 1000 }') },
  { nombre: 'nps: techo de mil', archivo: 'nps', romper: cambiar('{ techo: 50000 }', '{ techo: 1000 }') },
  { nombre: 'pipeline: sin el segundo PATCH', archivo: 'pipe', romper: cambiar("const resto = await sb(`${base}&select=id`, 'PATCH'", "const resto = await sb(`${base}&select=id&stage=eq.__nada__`, 'PATCH'") },
  { nombre: 'pipeline: todos a nuevo', archivo: 'pipe', romper: cambiar('const conEtapa = validas.size', 'const conEtapa = false') },
  { nombre: 'admin: total por filas', archivo: 'admin', romper: cambiar("return parseInt(String(r.headers.get('content-range') || '').split('/')[1], 10) || 0;", 'return (await r.json()).length;') },
  { nombre: 'admin: métricas sin paginar', archivo: 'admin', romper: cambiar("    todasLas('/users?select=id,email,plan,status", "    supabaseReq('/users?select=id,email,plan,status") },
  { nombre: 'admin: uso de IA con techo de mil', archivo: 'admin', romper: cambiar("SB_LECTURA(), { techo: 100000 }\n    ));", "SB_LECTURA(), { techo: 1000 }\n    ));") },
  { nombre: 'intake: solo la primera página', archivo: 'intake', romper: cambiar('for (let offset = 0; offset < 20000; offset += 1000) {', 'for (let offset = 0; offset < 1000; offset += 1000) {') },
  { nombre: 'intake: sin filtro por la cola', archivo: 'intake', romper: cambiar('&phone=like.*${cola}&', '&phone=not.is.null&') },
];

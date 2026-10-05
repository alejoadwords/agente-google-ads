// Mutaciones del agente de voz — node tools/mutar.mjs pruebas/mutaciones/agente-voz.mjs

export const SUITE = 'pruebas/agente-voz.mjs';
export const ARCHIVOS = { lib: 'api/_agente-voz.js', api: 'api/agente-voz.js', w: 'voz-agente/acuarius.js' };
const cambiar = (de, a) => (s) => { if (!s.includes(de)) throw new Error('no está: ' + de); return s.replace(de, a); };

export const MUTACIONES = [
  { nombre: 'redondea hacia abajo', archivo: 'lib', romper: cambiar('Math.ceil(s / 60)', 'Math.floor(s / 60)') },
  { nombre: 'cobra las que no conectaron', archivo: 'lib', romper: cambiar('return s === 0 ? 0 : Math.ceil', 'return s === 0 ? 1 : Math.ceil') },
  { nombre: 'costo con el redondeo', archivo: 'lib', romper: cambiar('Math.max(0, Number(segundos) || 0) / 60 * COSTO_MINUTO_USD', 'Math.ceil(Math.max(0, Number(segundos) || 0) / 60) * COSTO_MINUTO_USD') },
  { nombre: 'precio cambiado', archivo: 'lib', romper: cambiar("usd: 79, minutos: 300", "usd: 79, minutos: 400") },
  { nombre: 'worker sin secreto', archivo: 'lib', romper: cambiar("if (!esperado || dado.length !== esperado.length) return false;", "if (!esperado) return false; return true;") },
  { nombre: 'token sin despachar el worker', archivo: 'lib', romper: cambiar("roomConfig: { agents: [{ agentName: agente, metadata: metadata || '' }] }", "roomConfig: {}") },
  { nombre: 'sin reglas de voz', archivo: 'lib', romper: cambiar('    REGLAS_DE_VOZ,\n', '') },
  { nombre: 'beta ignorada', archivo: 'api', romper: cambiar("if (!agente.activo || !agenteVozActivo(agente.user_id)) {", "if (!agente.activo) {") },
  { nombre: 'sin saldo contesta igual', archivo: 'api', romper: cambiar('if (saldo <= 0) {', 'if (false) {') },
  { nombre: 'prueba con saldo y sin tope', archivo: 'api', romper: cambiar('let maxSegundos = MAX_SEGUNDOS_PRUEBA;', 'let maxSegundos = MAX_SEGUNDOS_LLAMADA;') },
  { nombre: 'sin tope de 30 min', archivo: 'api', romper: cambiar('maxSegundos = Math.min(MAX_SEGUNDOS_LLAMADA, saldo * 60);', 'maxSegundos = saldo * 60;') },
  { nombre: 'prueba crea leads', archivo: 'api', romper: cambiar("if (prueba) return json({ ok: true, prueba: true, texto: 'Datos anotados", "if (false) return json({ ok: true, prueba: true, texto: 'Datos anotados") },
  { nombre: 'prueba se cobra', archivo: 'api', romper: cambiar('const minutos = prueba ? 0 : minutosCobrados(segundos);', 'const minutos = minutosCobrados(segundos);') },
  { nombre: 'fin doble cobra', archivo: 'api', romper: cambiar("if (llamada.fin && llamada.estado !== 'en_curso') return json({ ok: true, repetida: true, minutos: llamada.minutos_cobrados });", '') },
  { nombre: 'sin nota en la ficha', archivo: 'api', romper: cambiar("if (!prueba && llamada.lead_id) {\n    const m = Math.floor", "if (false) {\n    const m = Math.floor") },
  { nombre: 'edita agentes ajenos', archivo: 'api', romper: cambiar("const filas = await sb(`/agentes_voz?id=eq.${encodeURIComponent(b.agente.id)}&user_id=eq.${c}&", "const filas = await sb(`/agentes_voz?id=eq.${encodeURIComponent(b.agente.id)}&") },
  { nombre: 'prueba agentes ajenos', archivo: 'api', romper: cambiar("const [agente] = await sb(`/agentes_voz?id=eq.${encodeURIComponent(b.agente_id)}&user_id=eq.${c}&select=id,nombre`);", "const [agente] = await sb(`/agentes_voz?id=eq.${encodeURIComponent(b.agente_id)}&select=id,nombre`);") },
  { nombre: 'no reconoce al que llama', archivo: 'api', romper: cambiar("endsWith(d.slice(-10))) || null;", "endsWith('x')) || null;") },
  { nombre: 'fin sin reintentos', archivo: 'w', romper: cambiar('...datos }, 4),', '...datos }, 1),') },
  { nombre: 'reintenta los 4xx', archivo: 'w', romper: cambiar('if (r.status < 500) return { status: r.status, ...d };', 'if (r.status < 400) return { status: r.status, ...d };') },
  { nombre: 'transcripción con el sistema', archivo: 'w', romper: cambiar(".filter(m => m && (m.role === 'user' || m.role === 'assistant'))", '.filter(m => m)') },
  { nombre: 'sin caché', archivo: 'w', romper: cambiar("sistema[ultimo] = { ...sistema[ultimo], cache_control: { type: 'ephemeral' } };", '') },
  { nombre: 'latencia que suma mal', archivo: 'w', romper: cambiar('(promedio(eou) + promedio(llm) + promedio(tts))', '(promedio(llm) + promedio(tts))') },
  { nombre: 'velocidad libre', archivo: 'api', romper: cambiar('velocidad: Object.values(VELOCIDADES).includes(Number(a.velocidad)) ? Number(a.velocidad) : VELOCIDAD_DEFECTO,', 'velocidad: Number(a.velocidad) || VELOCIDAD_DEFECTO,') },
  { nombre: 'sin regla de no inventar', archivo: 'lib', romper: cambiar('- Solo condiciones, precios, plazos', '- Condiciones, precios, plazos') },
  { nombre: 'presupuesto como texto', archivo: 'api', romper: cambiar("typeof a.presupuesto === 'number' ? a.presupuesto : aPlata(a.presupuesto)", 'a.presupuesto') },
  { nombre: 'zona en campo que no se lee', archivo: 'api', romper: cambiar("    barrio: (a.zona || a.barrio || '').trim() || undefined,", "    zona: (a.zona || a.barrio || '').trim() || undefined,") },
  { nombre: 'tipo sin mayúscula', archivo: 'api', romper: cambiar("tipo ? tipo.charAt(0).toUpperCase() + tipo.slice(1) : undefined", "tipo || undefined") },
  { nombre: 'ensayo con otro modelo', archivo: 'api', romper: cambiar("const MODELO_VOZ = 'claude-haiku-4-5';", "const MODELO_VOZ = 'claude-sonnet-4-5';") },
  { nombre: 'ensayo no ejecuta herramientas', archivo: 'api', romper: cambiar("const d = await (await ejecutar({ llamada_id: cfg.llamada_id, nombre: u.name, args: u.input, contexto })).json();", "const d = { texto: 'Hecho.' };") },
  { nombre: 'ensayo sigue tras colgar', archivo: 'api', romper: cambiar("    if (colgo) break;\n", "") },
  { nombre: 'sin habitaciones de la conversación', archivo: 'api', romper: cambiar("        if (h) pistas.habitaciones = h;", "") },
  { nombre: 'cualquier número son habitaciones', archivo: 'api', romper: cambiar("if (antes && HABITACION.test(antes.texto) && /\\?/.test(antes.texto)) {", "if (antes) {") },
  { nombre: 'correo sin limpiar', archivo: 'api', romper: cambiar("        email: correoLimpio(a.correo) || undefined,", "        email: a.correo || undefined,") },
];

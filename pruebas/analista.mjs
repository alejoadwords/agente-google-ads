// Analista IA de la pauta (api/_analista.js): node pruebas/analista.mjs
//
// El modelo propone; el servidor decide qué de eso puede llegar a ser un botón.
// Aquí se prueba esa frontera con lo que el modelo hizo de verdad en los
// ensayos del 03-10-2026: proponer excluir «cremación de mascotas» a una
// funeraria de mascotas, y recortar una campaña cuyos leads no llegaban al CRM.
process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';
const { validarRecomendaciones } = await import('../api/_analista.js');

let mal = 0;
const ok = (c, t, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + t + (!c && extra ? ' → ' + extra : '')); if (!c) mal++; };
const V = (x) => ({ inversion: 500000, clics: 300, conv_red: 0, leads_crm: 10, ganados: 1, perdidos: 3, en_proceso: 6, ingresos: 0, ...x });
const foto = {
  campanas: [
    { red: 'google', id: '111', nombre: 'Search', estado: 'enabled', conexion_id: 'cg', ultimos_30: V() },
    { red: 'google', id: '222', nombre: 'PMax', estado: 'enabled', conexion_id: 'cg', ultimos_30: V({ conv_red: 238.7, leads_crm: 0 }) },
    { red: 'meta', id: '333', nombre: 'Vieja', estado: 'paused', conexion_id: 'cm', ultimos_30: V() },
  ],
  busquedas: [{
    conexion_id: 'cg', modo: 'conversiones',
    palabras: [{ texto: 'dueño', campanas: ['111'] }, { texto: 'gratis', campanas: ['111', '444'] }],
    busquedas: [{ texto: 'venta de perros pincher', campana_id: '111', de_tu_negocio: false },
      { texto: 'cremación de mascotas', campana_id: '111', de_tu_negocio: true }],
  }],
  decisiones_30d: [{ accion: 'pausar', campana_id: '111', estado: 'propuesta' }],
};
const v = (recs) => validarRecomendaciones(recs, foto);
const R = (x) => ({ titulo: 'Algo', por_que: 'Porque sí', prioridad: 'alta', ...x });

console.log('Pausar y bajar presupuesto');
let r = v([R({ tipo: 'bajar_presupuesto', campana_id: '111', porcentaje: 80 })])[0];
ok(r.tipo === 'bajar_presupuesto' && r.acciones[0].porcentaje === 50 && r.acciones[0].conexion_id === 'cg', 'un recorte de 80 % se limita a 50 %, con la conexión de la campaña', JSON.stringify(r));
ok(v([R({ tipo: 'bajar_presupuesto', campana_id: '111', porcentaje: 1 })])[0].acciones[0].porcentaje === 5, 'y uno de 1 % sube al mínimo de 5 %');
r = v([R({ tipo: 'pausar', campana_id: '999' })])[0];
ok(r.tipo === 'consejo' && !r.acciones.length && /No se encontró/.test(r.nota), 'un id de campaña inventado baja a consejo');
ok(v([R({ tipo: 'pausar', campana_id: '333' })])[0].tipo === 'consejo', 'una campaña ya pausada: consejo');
r = v([R({ tipo: 'bajar_presupuesto', campana_id: '222' })])[0];
ok(r.tipo === 'consejo' && /conectar la captura/.test(r.nota), 'la red cuenta 238 conversiones y el CRM 0 leads: no se recorta, se pide conectar la captura');
r = v([R({ tipo: 'pausar', campana_id: '111' })])[0];
ok(r.tipo === 'consejo' && /esperando tu aprobación/.test(r.nota), 'lo que ya espera aprobación no se propone dos veces');

console.log('Negativas');
r = v([R({ tipo: 'negativa', texto_negativa: 'cremación de mascotas' })])[0];
ok(r.tipo === 'consejo' && /propio negocio/.test(r.nota), 'una búsqueda del propio negocio NUNCA es acción, diga lo que diga el modelo');
r = v([R({ tipo: 'negativa', texto_negativa: 'Venta de perros PINCHER' })])[0];
ok(r.tipo === 'negativa' && r.acciones[0].detalle.tipo === 'EXACT' && r.acciones[0].detalle.texto === 'venta de perros pincher', 'una búsqueda candidata: exacta, con el texto de los datos (no el del modelo)');
r = v([R({ tipo: 'negativa', texto_negativa: 'gratis' })])[0];
ok(r.acciones.length === 2 && r.acciones.every(a => a.detalle.tipo === 'PHRASE'), 'una palabra candidata: de frase, en todas sus campañas');
ok(v([R({ tipo: 'negativa', texto_negativa: 'gratis', campana_id: '444' })])[0].acciones.map(a => a.campana_id).join() === '444', 'si el modelo dice la campaña, solo esa');
ok(v([R({ tipo: 'negativa', texto_negativa: 'empleo' })])[0].tipo === 'consejo', 'una palabra que no está en los datos: consejo');

console.log('Forma');
ok(v([R({ tipo: 'activar', campana_id: '111' })])[0].tipo === 'consejo', 'un tipo que no existe (activar) no es acción');
ok(v([R({ tipo: 'negativa', texto_negativa: 'gratis' }), R({ tipo: 'negativa', texto_negativa: 'gratis' })])[1].acciones.length === 0, 'la misma negativa dos veces: una sola acción');
ok(v(Array.from({ length: 12 }, () => R({ tipo: 'consejo' }))).length === 8, 'máximo 8 recomendaciones');
ok(v([R({ titulo: '' })]).length === 0 && v(null).length === 0, 'sin título o sin lista: nada');
ok(v([R({ prioridad: 'urgentísima', tipo: 'consejo' })])[0].prioridad === 'media', 'una prioridad rara queda en media');

console.log(mal ? `\n${mal} fallo(s)\n` : '\nTodo en orden\n');
process.exit(mal ? 1 : 0);

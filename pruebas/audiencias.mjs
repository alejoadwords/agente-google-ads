// Audiencias del CRM (api/_audiencias.js): node pruebas/audiencias.mjs
//
// Lo que importa: que entre en cada grupo quien debe (un lead perdido no es
// «cliente»), que correo y teléfono se cifren como pide CADA red (Google quiere
// el teléfono con «+», Meta sin él), y que cada envío mande solo la diferencia.
process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';
const { cumpleFiltro, llavesDe, diferencia, errorLegible } = await import('../api/_audiencias.js');
const { validarAudiencia } = await import('../api/audiencias.js');
const { sha256 } = await import('../api/_conversiones.js');
let mal = 0;
const ok = (c, t, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + t + (!c && x ? ' → ' + x : '')); if (!c) mal++; };
const L = (x) => ({ stage: 'nuevo', tags: [], created_at: '2026-10-01T00:00:00Z', ...x });
const ahora = Date.parse('2026-10-05T00:00:00Z');

console.log('Quién entra en cada grupo');
ok(cumpleFiltro(L({ stage: 'ganado' }), 'clientes') && !cumpleFiltro(L({ stage: 'perdido' }), 'clientes') && !cumpleFiltro(L(), 'clientes'), 'clientes: solo los ganados');
ok(cumpleFiltro(L(), 'en_proceso') && !cumpleFiltro(L({ stage: 'ganado' }), 'en_proceso') && !cumpleFiltro(L({ stage: 'cita', closed_at: '2026-09-01' }), 'en_proceso'), 'en proceso: ni ganados, ni perdidos, ni cerrados');
ok(cumpleFiltro(L({ stage: 'perdido', close_reason: 'Precio alto' }), 'perdidos', { motivos: ['Precio alto'] }) && !cumpleFiltro(L({ stage: 'perdido', close_reason: 'Corredor' }), 'perdidos', { motivos: ['Precio alto'] }), 'perdidos, con filtro por motivo');
ok(cumpleFiltro(L({ tags: ['VIP', 'arriendo'] }), 'etiquetas', { etiquetas: ['vip'] }) && !cumpleFiltro(L({ tags: ['arriendo'] }), 'etiquetas', { etiquetas: ['vip'] }), 'etiquetas, sin importar mayúsculas');
ok(!cumpleFiltro(L(), 'etiquetas', {}), 'etiquetas sin etiquetas elegidas: nadie (no «todos»)');
ok(!cumpleFiltro(L({ created_at: '2026-01-01T00:00:00Z' }), 'todos', { dias: 90 }, ahora) && cumpleFiltro(L(), 'todos', { dias: 90 }, ahora), 'solo los de los últimos N días');

console.log('Cifrado como pide cada red');
const g = await llavesDe({ email: ' Ana.Perez@Gmail.com ', phone: '300 123 4567' }, 'google');
const m = await llavesDe({ email: ' Ana.Perez@Gmail.com ', phone: '300 123 4567' }, 'meta');
ok(g.h_email === await sha256('anaperez@gmail.com'), 'Google: correo en minúsculas, sin espacios y sin puntos en Gmail');
ok(m.h_email === await sha256('ana.perez@gmail.com'), 'Meta: correo en minúsculas y sin espacios (los puntos se quedan)');
ok(g.h_tel === await sha256('+573001234567') && m.h_tel === await sha256('573001234567'), 'teléfono colombiano: Google con «+57», Meta solo dígitos con 57');
ok(/^[0-9a-f]{64}$/.test(g.h_email) && !JSON.stringify(g).includes('anaperez'), 'nunca sale un dato en claro: SHA-256 en hexadecimal');
ok(await llavesDe({ email: 'no-es-correo', phone: '12' }, 'meta') === null, 'sin correo ni teléfono válidos, el lead no se envía');

console.log('Solo la diferencia');
const d = diferencia([{ lead_id: 'a', h_email: '1' }, { lead_id: 'b', h_email: '2' }, { lead_id: 'c', h_email: 'nuevo' }],
  [{ lead_id: 'a', h_email: '1' }, { lead_id: 'c', h_email: 'viejo' }, { lead_id: 'z', h_email: '9' }]);
ok(d.entran.map(x => x.lead_id).sort().join() === 'b,c' && d.salen.map(x => x.lead_id).sort().join() === 'c,z', 'entra el nuevo; sale el que dejó el grupo; el que cambió de correo sale con el viejo y entra con el nuevo', JSON.stringify(d));
ok(diferencia([{ lead_id: 'a', h_email: '1' }], [{ lead_id: 'a', h_email: '1' }]).entran.length === 0, 'sin cambios no se envía nada');

console.log('Errores, dichos para quien los lee');
ok(/Dar permiso en Google/.test(errorLegible({ sinPermiso: true }, 'google')), 'sin el permiso de audiencias: qué botón pulsar');
ok(/customaudiences\/tos/.test(errorLegible({ meta: { error_subcode: 1870034 }, message: 'x' }, 'meta')), 'Meta sin términos aceptados: el enlace para aceptarlos');

console.log('Lo que manda el navegador');
const B = { nombre: 'Clientes', segmento: 'clientes', conexion_id: 'c1', consentimiento: true };
ok(!!validarAudiencia(B).audiencia, 'una audiencia válida');
ok(/autorización/.test(validarAudiencia({ ...B, consentimiento: false }).error || ''), 'sin declarar el consentimiento de los contactos, no');
ok(!!validarAudiencia({ ...B, segmento: 'etiquetas', filtro: {} }).error && validarAudiencia({ ...B, segmento: 'etiquetas', filtro: { etiquetas: 'vip, arriendo' } }).audiencia.filtro.etiquetas.length === 2, 'por etiquetas: al menos una, separadas por comas');
ok(!!validarAudiencia({ ...B, segmento: 'cualquiera' }).error, 'un grupo que no existe');
console.log(mal ? `\n${mal} fallo(s)\n` : '\nTodo en orden\n');
process.exit(mal ? 1 : 0);

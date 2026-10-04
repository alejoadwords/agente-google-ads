// Palabras negativas por calidad (api/_busquedas.js): node pruebas/busquedas.mjs
//
// Los casos salen de dos cuentas reales revisadas el 03-10-2026: una funeraria
// de mascotas que pagaba por «venta de perros pincher», y una inmobiliaria con
// la medición de Google rota (todo en 0 conversiones, su marca incluida).
// Lo que más importa probar es lo que NUNCA se debe proponer.
process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';
const { analizarTerminos, calidadPorPalabra, norm } = await import('../api/_busquedas.js');
const { limpiarNegativa } = await import('../api/busquedas.js');
const { sinPalabra, completarPalabras, SIN_PALABRA } = await import('../api/_gclid.js');

let mal = 0;
const ok = (c, t, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + t + (!c && extra ? ' → ' + extra : '')); if (!c) mal++; };
const T = (texto, costo, clics, conv, x) => ({ texto, estado: 'NONE', campanaId: '1', campana: 'Search', costo, clics, conv, crmCalif: 0, crmVentas: 0, ...x });

// Funeraria: CPL de la cuenta = 187.000 / 10 conversiones = 18.700
const funeraria = {
  terminos: [
    T('cremacion de mascotas cali', 60000, 20, 10),
    T('venta de perros pincher en cali', 25000, 3, 0),
    T('cremacion mascotas gratis', 12000, 4, 0),
    T('cremacion mascotas gratis cali', 9000, 3, 0),
    T('tierra de mascotas cali', 30000, 10, 0),
    T('tierra mascotas', 15000, 3, 0),
    T('funeraria para mascotas', 20000, 4, 0),
    T('pincher', 3000, 1, 0),
    T('crematorio barato', 4000, 1, 0),
    T('cementerio de mascotas', 9000, 3, 0, { estado: 'ADDED' }),
  ],
  claves: ['cremación de mascotas cali', 'funeraria para mascotas', 'cementerio de mascotas'],
  negativas: [],
  marca: ['Tierra de Mascotas'],
};
const a = analizarTerminos(funeraria);
const terms = a.terminos.map(t => t.texto), pals = a.palabras.map(p => p.texto);
console.log('Con conversiones');
ok(a.modo === 'conversiones' && Math.round(a.cpl) === 18700, 'modo conversiones y CPL de la cuenta', a.modo + ' ' + a.cpl);
ok(terms.includes('venta de perros pincher en cali'), 'propone la búsqueda que gastó más de un CPL sin convertir');
ok(!terms.includes('cremacion de mascotas cali'), 'no propone la que convierte');
ok(!terms.includes('pincher') && !terms.includes('crematorio barato'), 'no propone lo que gastó menos de un CPL (aún no hay con qué juzgar)');
ok(!terms.includes('cementerio de mascotas'), 'no propone lo que ya es palabra clave (ADDED)');
console.log('La marca nunca');
ok(!terms.includes('tierra de mascotas cali') && !terms.includes('tierra mascotas'), 'búsquedas de la marca: nunca, aunque no conviertan');
ok(!pals.includes('tierra'), 'ni la palabra de la marca');
const f = a.terminos.find(t => t.texto === 'funeraria para mascotas');
ok(f && f.propia === true, '«funeraria para mascotas» sale, pero marcada como de tu negocio (todas sus palabras están en tus claves)');
ok(a.terminos.find(t => t.texto.startsWith('venta de perros'))?.propia === false, '«venta de perros…» no es de tu negocio');
console.log('Palabras sueltas');
ok(pals.includes('gratis'), '«gratis» repetida en dos búsquedas sin convertir → palabra a excluir', JSON.stringify(pals));
ok(!pals.includes('cremacion') && !pals.includes('mascotas') && !pals.includes('cali'), 'nunca una palabra que esté en tus palabras clave');
ok(!pals.includes('para') && !pals.includes('de'), 'nunca palabras vacías');

console.log('Negativas que ya existen, por campaña');
const conNeg = analizarTerminos({ ...funeraria, negativas: [{ texto: 'gratis', campanaId: '1' }] });
ok(!conNeg.palabras.some(p => p.texto === 'gratis') && !conNeg.terminos.some(t => /gratis/.test(t.texto)), '«gratis» ya negativa en esa campaña: no se vuelve a proponer');
const otraCamp = analizarTerminos({ ...funeraria, negativas: [{ texto: 'gratis', campanaId: '99' }] });
ok(otraCamp.palabras.some(p => p.texto === 'gratis'), '…pero si es negativa en OTRA campaña, en esta sigue entrando y se propone');
ok(!analizarTerminos({ ...funeraria, negativas: ['pincher'] }).terminos.some(t => /pincher/.test(t.texto)), 'una negativa de toda la cuenta tapa todas las campañas');

console.log('Medición rota (todo en 0 conversiones)');
const rota = analizarTerminos({
  terminos: [T('certain pezzano', 12000, 199, 0), T('metro cuadrado barranquilla', 50000, 20, 0), T('metro cuadrado', 30000, 6, 0),
    T('apartamentos dueño directo', 20000, 10, 0), T('inmobiliaria barranquilla', 40000, 50, 0)],
  claves: ['Certain Pezzano', 'inmobiliaria barranquilla', 'apartamentos en venta barranquilla'], marca: ['Certain & Pezzano'],
});
ok(rota.modo === 'gasto' && rota.cpl === null, 'sin conversiones en la cuenta, no hay CPL ni veredicto');
ok(rota.terminos.length === 0, 'ningún término se propone por «0 conversiones» si nadie convierte');
ok(rota.palabras.some(p => p.texto === 'metro cuadrado' && p.motivo === null), 'las palabras salen para revisar, sin veredicto, y unidas: «metro cuadrado»', JSON.stringify(rota.palabras.map(p => p.texto)));
ok(!rota.palabras.some(p => /certain|pezzano/.test(p.texto)), 'su marca jamás aparece, ni siquiera para revisar');
ok(rota.palabras.some(p => p.texto === 'dueño directo' || p.texto === 'dueño'), 'la ñ se conserva: «dueño», no «dueno»', JSON.stringify(rota.palabras.map(p => p.texto)));

console.log('Con las etapas del CRM en Google');
const crm = analizarTerminos({ terminos: [T('casas baratas', 40000, 20, 4), T('casas en venta', 40000, 20, 4, { crmCalif: 2 }), T('otro', 40000, 20, 12)], crmActivo: true });
ok(crm.terminos.some(t => t.texto === 'casas baratas' && /ninguno avanzó/.test(t.motivo)), 'trae leads según Google pero ninguno avanza en el CRM → se propone', JSON.stringify(crm.terminos));
ok(!crm.terminos.some(t => t.texto === 'casas en venta'), 'si alguno avanzó, no');

console.log('Calidad por palabra clave');
const L = (k, stage, close_reason) => ({ custom_fields: { 'Palabra clave': k }, stage, close_reason });
const c = calidadPorPalabra([L('casas baratas', 'perdido', 'Sin presupuesto'), L('casas baratas', 'perdido', 'Sin presupuesto'), L('casas baratas', 'perdido', 'No era el perfil'),
  L('casas en venta', 'ganado'), L('casas en venta', 'nuevo'), { custom_fields: {}, stage: 'nuevo' }]);
const cb = c.find(x => x.palabra === 'casas baratas');
ok(cb.leads === 3 && cb.perdidos === 3 && cb.flojo && cb.motivos[0].motivo === 'Sin presupuesto' && cb.motivos[0].n === 2, 'cuenta leads, pérdidas y el motivo más repetido; la marca «floja»');
ok(c.find(x => x.palabra === 'casas en venta').flojo === false && c.length === 2, 'con una venta no es floja; sin palabra clave no cuenta');

console.log('Texto de la negativa');
ok(limpiarNegativa('  Dueño  Directo ').texto === 'dueño directo', 'minúsculas, espacios, tildes intactas');
ok(!!limpiarNegativa('a b c d e f g h i j k').error && !!limpiarNegativa('').error, 'más de 10 palabras o vacía: no');
ok(norm('Cremación de Mascotas, Cali!') === 'cremacion de mascotas cali', 'norm quita tildes y signos');

console.log('Palabra clave de los leads ya resueltos');
const ahora = Date.parse('2026-10-03T12:00:00Z');
const lead = (x) => ({ id: x.id, created_at: x.d, custom_fields: { 'Clic de anuncio': x.g, 'Plataforma': 'Google', 'ID de campaña': '5', ...(x.cf || {}) } });
const leads = [lead({ id: 1, d: '2026-10-01T15:00:00Z', g: 'A' }), lead({ id: 2, d: '2026-10-01T16:00:00Z', g: 'B' }),
  lead({ id: 3, d: '2026-05-01T10:00:00Z', g: 'C' }), lead({ id: 4, d: '2026-10-02T10:00:00Z', g: 'D', cf: { 'Palabra clave': 'ya' } })];
ok(sinPalabra(leads, ahora).map(l => l.id).join() === '1,2', 'pendientes: con campaña, sin palabra y dentro de 90 días');
const guardados = {};
const r = await completarPalabras({ leads, ahora, consultarDia: async () => [{ gclid: 'A', palabra: 'casas cali' }, { gclid: 'B', palabra: '' }], guardar: async (id, c) => { guardados[id] = c; } });
ok(r.resueltos === 1 && r.sin_palabra === 1 && guardados[1]['Palabra clave'] === 'casas cali' && guardados[2][SIN_PALABRA] === true, 'guarda la palabra, y marca el clic sin palabra (Performance Max) para no volver a preguntar');
ok(sinPalabra(leads, ahora).length === 0, 'tras completarla, ya no queda pendiente en esta misma carga');

console.log(mal ? `\n${mal} fallo(s)\n` : '\nTodo en orden\n');
process.exit(mal ? 1 : 0);

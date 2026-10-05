// Reglas automáticas de la pauta (api/_reglas-pauta.js): node pruebas/reglas-pauta.mjs
//
// Una regla puede pausar una campaña de un cliente. Lo que se prueba aquí es
// que dispare solo cuando debe, y sobre todo que NO dispare cuando el dato no
// alcanza para juzgar: pausar por un error de cuentas cuesta ventas.
process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';
const { evaluarRegla, textoAccion } = await import('../api/_reglas-pauta.js');
const { validarRegla } = await import('../api/reglas-pauta.js');

let mal = 0;
const ok = (c, t, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + t + (!c && extra ? ' → ' + extra : '')); if (!c) mal++; };
const camp = (x) => ({ red: 'meta', id: '111', nombre: 'Leads Bogotá', estado: 'ACTIVE', objetivo: 'OUTCOME_LEADS', moneda: 'COP',
  inv: 600000, leads: 10, ganados: 1, huerfanos: 0, dudoso: false, conexion_id: 'c1', ...x });
const regla = (x) => ({ red: 'todas', metrica: 'cpl_real', dias: 7, umbral: 50000, accion: 'pausar', ...x });
const dispara = (r, c) => evaluarRegla(regla(r), [camp(c)]).length === 1;
const motivo = (r, c) => (evaluarRegla(regla(r), [camp(c)])[0] || {}).motivo || '';

console.log('Costo por lead real');
ok(dispara({}, {}), '600.000 / 10 leads = 60.000 > 50.000 → dispara');
ok(!dispara({ umbral: 70000 }, {}), 'por debajo del límite no dispara');
ok(/60\.000/.test(motivo({}, {})) && /10 leads/.test(motivo({}, {})) && /7 días/.test(motivo({}, {})), 'el motivo dice el CPL, los leads y la ventana', motivo({}, {}));
ok(dispara({}, { leads: 0 }), 'sin leads y con más gasto que el límite → dispara (CPL infinito)');
ok(!dispara({}, { leads: 0, inv: 40000 }), 'sin leads pero con menos gasto que un lead: aún no se sabe');

console.log('Costo por venta');
ok(dispara({ metrica: 'costo_venta', umbral: 500000 }, {}), '600.000 por 1 venta > 500.000 → dispara');
ok(!dispara({ metrica: 'costo_venta', umbral: 500000 }, { ganados: 2 }), '300.000 por venta → no');
ok(/sin ninguna venta/.test(motivo({ metrica: 'costo_venta', umbral: 500000 }, { ganados: 0 })), 'sin ventas y gasto por encima → lo dice así');

console.log('Gasto sin leads');
ok(dispara({ metrica: 'gasto_sin_leads', umbral: 200000 }, { leads: 0 }), 'gastó 600.000 sin leads, límite 200.000 → dispara');
ok(!dispara({ metrica: 'gasto_sin_leads', umbral: 200000 }, { leads: 1 }), 'con un lead ya no es «sin leads»');
ok(!dispara({ metrica: 'gasto_sin_leads', umbral: 200000 }, { leads: 0, objetivo: 'OUTCOME_TRAFFIC' }), 'una campaña de tráfico no tiene por qué traer leads');
ok(dispara({ metrica: 'costo_venta', umbral: 500000 }, { objetivo: 'OUTCOME_TRAFFIC' }), '…pero el costo por venta sí se le puede pedir');

console.log('Lo que nunca se juzga');
ok(!dispara({}, { estado: 'PAUSED' }), 'una campaña ya pausada');
ok(!dispara({}, { red: 'google', estado: 'ENABLED', dudoso: true }), 'Google sin poder atribuir los clics: no se sabe de qué campaña es cada lead');
ok(dispara({}, { red: 'google', estado: 'ENABLED' }), 'Google con la atribución al día sí se juzga');

console.log('Alcance');
ok(!dispara({ red: 'google' }, {}), 'regla de Google no toca Meta');
ok(dispara({ red: 'meta' }, {}), 'regla de Meta sí');
ok(!dispara({ campana_id: '222' }, {}), 'regla de otra campaña no toca esta');
ok(dispara({ campana_id: '111' }, {}), 'regla de esta campaña sí');

console.log('Honestidad del motivo');
ok(/3 leads del periodo entraron sin dato de campaña/.test(motivo({}, { huerfanos: 3 })), 'si hay leads sin campaña, el motivo lo advierte');
ok(!/sin dato de campaña/.test(motivo({}, {})), 'si no hay, no ensucia el motivo');
ok(textoAccion({ accion: 'bajar_presupuesto', porcentaje: 20 }) === 'Bajar el presupuesto un 20 %', 'texto de la acción');

console.log('Validación de lo que manda el navegador');
const base = { nombre: 'CPL alto', red: 'todas', metrica: 'cpl_real', dias: 7, umbral: '50.000', accion: 'pausar', modo: 'auto' };
const v = validarRegla(base);
ok(v.regla && v.regla.umbral === 50000, 'el límite «50.000» se lee como 50000', JSON.stringify(v));
const { leerMonto } = await import('../api/reglas-pauta.js');
ok(leerMonto('$ 1.250.000') === 1250000, '«$ 1.250.000» → 1250000');
ok(leerMonto('12,50') === 12.5 && leerMonto('12.50') === 12.5, 'decimales con coma o con punto (USD)');
ok(leerMonto('1,250,000') === 1250000 && leerMonto(80000) === 80000, 'miles con coma, y un número tal cual');
ok(v.regla?.modo === 'auto', 'pausar puede ir en automático');
ok(validarRegla({ ...base, accion: 'avisar' }).regla?.modo === 'aprobar', '«avisar» nunca es automático: no hay qué ejecutar');
ok(/1 % al 50 %/.test(validarRegla({ ...base, accion: 'bajar_presupuesto', porcentaje: 80 }).error || ''), 'no se baja más del 50 % de un golpe');
ok(validarRegla({ ...base, accion: 'bajar_presupuesto', porcentaje: 20 }).regla?.porcentaje === 20, 'un 20 % sí');
ok(!!validarRegla({ ...base, accion: 'subir_presupuesto' }).error, 'subir presupuesto no existe');
ok(!!validarRegla({ ...base, accion: 'activar' }).error, 'activar no existe');
ok(!!validarRegla({ ...base, dias: 30 }).error, 'ventana fuera de 3/7/14');
ok(!!validarRegla({ ...base, umbral: '0' }).error, 'límite cero');
ok(!!validarRegla({ ...base, nombre: '  ' }).error, 'sin nombre');
ok(validarRegla({ ...base, campana_id: 'abc' }).regla?.campana_id === null, 'un id de campaña sin dígitos se ignora');

console.log(mal ? `\n${mal} fallo(s)\n` : '\nTodo en orden\n');
process.exit(mal ? 1 : 0);

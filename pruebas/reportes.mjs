// Reportes programados (api/_reportes.js): node pruebas/reportes.mjs
//
// Lo delicado son las fechas: un reporte mensual que el 1 de enero reporta
// diciembre del año ANTERIOR, una quincena que cruza el fin de mes, una semana
// que empieza en lunes. Y que los totales no mezclen leads de pauta con el resto.
process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';
const { periodoDe, proximoEnvio, resumirPeriodo, cuerpoDelCorreo, hoyColombia, avisoAtribucion } = await import('../api/_reportes.js');

let mal = 0;
const ok = (c, t, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + t + (!c && extra ? ' → ' + extra : '')); if (!c) mal++; };
const P = (f, h) => { const p = periodoDe(f, h); return p.desde + '..' + p.hasta + ' | ' + p.anterior.desde + '..' + p.anterior.hasta; };

console.log('Semanal (lunes a domingo)');
ok(P('semanal', '2026-10-05') === '2026-09-28..2026-10-04 | 2026-09-21..2026-09-27', 'el lunes 5 de octubre reporta la semana del 28-09 al 4-10', P('semanal', '2026-10-05'));
ok(P('semanal', '2026-10-08') === '2026-09-28..2026-10-04 | 2026-09-21..2026-09-27', 'un jueves (envío atrasado) reporta la misma semana cerrada');
ok(periodoDe('semanal', '2026-10-05').etiqueta === '28 de septiembre al 4 de octubre de 2026', 'etiqueta que cruza de mes', periodoDe('semanal', '2026-10-05').etiqueta);
console.log('Quincenal');
ok(P('quincenal', '2026-10-16') === '2026-10-01..2026-10-15 | 2026-09-16..2026-09-30', 'el 16 reporta la primera quincena; compara con la segunda del mes anterior', P('quincenal', '2026-10-16'));
ok(P('quincenal', '2026-03-01') === '2026-02-16..2026-02-28 | 2026-02-01..2026-02-15', 'el 1 de marzo reporta del 16 al 28 de febrero', P('quincenal', '2026-03-01'));
ok(periodoDe('quincenal', '2026-10-16').etiqueta === '1 al 15 de octubre de 2026', 'etiqueta en un solo mes');
console.log('Mensual');
ok(P('mensual', '2026-01-01') === '2025-12-01..2025-12-31 | 2025-11-01..2025-11-30', 'el 1 de enero reporta diciembre del año anterior', P('mensual', '2026-01-01'));
ok(P('mensual', '2026-03-01') === '2026-02-01..2026-02-28 | 2026-01-01..2026-01-31', 'febrero de 28 días');
ok(periodoDe('mensual', '2026-11-01').etiqueta === 'octubre de 2026', 'etiqueta del mes');
console.log('Próximo envío');
ok(proximoEnvio('semanal', '2026-10-04') === '2026-10-05' && proximoEnvio('semanal', '2026-10-05') === '2026-10-12', 'semanal: el lunes siguiente (estrictamente después)');
ok(proximoEnvio('quincenal', '2026-10-04') === '2026-10-16' && proximoEnvio('quincenal', '2026-10-16') === '2026-11-01', 'quincenal: el 16 o el 1');
ok(proximoEnvio('mensual', '2026-12-15') === '2027-01-01', 'mensual: cruza de año');
ok(hoyColombia(Date.parse('2026-10-05T03:00:00Z')) === '2026-10-04', 'a las 10 p. m. del domingo en Bogotá todavía es domingo');

console.log('Totales');
const C = (x) => ({ red: 'google', id: '1', nombre: 'Search', inversion: 1000000, clics: 500, impresiones: 9000, conv: 0, moneda: 'COP', ...x });
const L = (x) => ({ stage: 'nuevo', value: 0, source: 'web', custom_fields: {}, ...x });
const leads = [
  L({ stage: 'ganado', value: 3000000, custom_fields: { 'ID de campaña': '1' } }),
  L({ stage: 'perdido', custom_fields: { 'ID de campaña': '1' } }),
  L({ custom_fields: { 'ID de campaña': '1' } }),
  L({ custom_fields: { 'ID de campaña': '1' } }),
  L({ stage: 'ganado', value: 500000, source: 'referido' }),
];
const r = resumirPeriodo([C(), C({ red: 'meta', id: '2', nombre: 'Leads', inversion: 0, clics: 0 })], leads);
const t = r.totales;
ok(t.leads === 5 && t.leads_pauta === 4 && t.ganados === 2 && t.ganados_pauta === 1, 'leads del CRM (todos) y los de pauta por separado', JSON.stringify(t));
ok(t.cpl_real === 250000 && t.costo_venta === 1000000, 'costo por lead y por venta solo con lo de pauta');
ok(t.retorno === 3 && t.ingresos === 3500000 && t.ingresos_pauta === 3000000, 'retorno = ingresos de pauta / inversión (el referido no cuenta)');
ok(r.campanas.length === 1 && r.campanas[0].leads === 4, 'una campaña sin gasto ni leads no sale');
const rc = resumirPeriodo([C({ conv: 231.78 }), C({ id: '3', nombre: 'Search', conv: 0 })], []);
ok(rc.totales.conv_red === 231.78 && rc.campanas[0].conv_red === 231.78, 'las conversiones que cuenta la red se suman y van por campaña (Certain: 231,78 en PMax)');
ok(r.fuentes[0].fuente === 'web' && r.fuentes[0].n === 4, 'fuentes ordenadas');
ok(resumirPeriodo([], []).totales.cpl_real === null, 'sin pauta: costo por lead nulo, no cero');

console.log('Atribución');
ok(avisoAtribucion({ inversion: 3000000, leads: 456, leads_pauta: 1 }) === true, 'Certain: 3 millones invertidos y 1 de 456 leads con campaña → aviso');
ok(avisoAtribucion({ inversion: 3000000, leads: 40, leads_pauta: 12 }) === false, 'con 30 % de leads atribuidos, no');
ok(avisoAtribucion({ inversion: 0, leads: 456, leads_pauta: 0 }) === false && avisoAtribucion({ inversion: 100, leads: 5, leads_pauta: 0 }) === false, 'sin inversión, o con muy pocos leads, no');
ok(resumirPeriodo([], [L({ custom_fields: { 'ID de campaña': '9' } })]).totales.cpl_real === null, 'sin inversión el costo por lead es nulo, no $0');

console.log('Correo');
const fila = { token: 'x', resumen: 'Logramos <más> leads.', datos: { moneda: 'COP', etiqueta: 'octubre', actual: r, anterior: { totales: { ...t, leads: 4, cpl_real: 200000, ganados: 2, inversion: 1000000 } },
  hicimos: [{ que: 'Excluimos las búsquedas con «dueño» en «Search»' }], cuentas_sin_leer: ['Meta Cliente'] } };
const h = cuerpoDelCorreo(fila);
ok(/\$\s?1\.000\.000/.test(h) && />5</.test(h) && /▲ 25 %/.test(h), 'cifras con miles y variación de leads (+25 %)', h.slice(0, 300));
ok(/▲ 25 %/.test(h) && /#B4231F">▲ 25 %/.test(h.split('Costo por lead')[1]), 'un costo por lead que sube sale en rojo');
ok(/Logramos &lt;más&gt; leads/.test(h) && /dueño/.test(h), 'el resumen se escapa; lo que hicimos aparece');
ok(/No pudimos leer Meta Cliente/.test(h), 'una cuenta que no se pudo leer se dice');
const h2 = cuerpoDelCorreo({ ...fila, datos: { ...fila.datos, aviso_atribucion: true } });
ok(/Casi ningún lead/.test(h2) && !/Costo por lead/.test(h2) && /Ingresos/.test(h2), 'con aviso de atribución: se dice, y el costo por lead se cambia por ingresos');

console.log('Versión 2: Meta y lo que ve el modelo');
const { accionesDe, capaDe } = await import('../api/_meta-reporte.js');
const { compactarParaIA } = await import('../api/_reportes.js');
const ac = accionesDe([{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '156' }, { action_type: 'video_view', value: '567395' }, { action_type: 'lead', value: '4' }]);
ok(ac.conversaciones === 156 && ac.video === 567395 && ac.leads === 4, 'lee conversaciones de WhatsApp, video y formularios de los insights de Meta');
ok(capaDe('OUTCOME_AWARENESS', {}) === 'marca' && capaDe('OUTCOME_ENGAGEMENT', { conversaciones: 3 }) === 'captacion' && capaDe('OUTCOME_LEADS', {}) === 'captacion',
  'capa de marca o de captación: una campaña que abre conversaciones es captación aunque su objetivo sea interacción');
const dv2 = { etiqueta: 'septiembre de 2026', moneda: 'COP', hicimos: [], cuentas_sin_leer: [], aviso_atribucion: true,
  actual: { totales: { ...t, inversion: 3007487 }, fuentes: [], campanas: [{ id: '22', nombre: 'PMax', leads: 1 }] }, anterior: { totales: t },
  contactos: { actual: { total: 232 }, anterior: { total: 221 } },
  google: { totales: { inversion: 636322, conv: 231.78, ctr: 0.088, cpc: 68, cpa: 2745 }, totales_anterior: { inversion: 600000, conv: 221, cpa: 2700 },
    campanas: [{ id: '22', nombre: 'PMax', inversion: 636322, clics: 9318, ctr: 0.088, conv: 231.78, cpa: 2745, anterior: null }], busquedas: null },
  meta: [{ cuenta: 'X', totales: {}, totales_anterior: {}, capas: { marca: { cpm: 601 }, captacion: { cpm: 1300 } }, campanas: [], conjuntos: [],
    anuncios: [{ nombre: 'Alameda', inversion: 227786, conversaciones: 71, leads: 0, ctr: 0.86, texto: 'x', imagen: 'data:image/jpeg;base64,AAAA' }] }] };
const cp = compactarParaIA(dv2, 'Certain');
ok(cp.google.campanas[0].leads_crm_con_esta_campana === 1 && cp.google.campanas[0].conversiones === 231.8, 'el modelo ve, por campaña, las conversiones de Google y los leads del CRM (232 contra 1)');
ok(!JSON.stringify(cp).includes('base64'), 'las imágenes de los anuncios no van al modelo');
ok(cp.contactos_segun_plataformas.este_periodo.total === 232 && cp.crm.este_periodo.leads === 5, 'contactos de las plataformas y leads del CRM van separados');

console.log('Lo que manda el navegador');
const { validarPrograma } = await import('../api/reportes.js');
const B = { nombre: 'Certain', frecuencia: 'mensual', destinatarios: 'Ana@Cliente.com, ana@cliente.com; pedro@cliente.co' };
let v = validarPrograma(B);
ok(v.programa?.destinatarios.join() === 'ana@cliente.com,pedro@cliente.co', 'correos separados por coma o punto y coma, en minúsculas y sin repetir', JSON.stringify(v));
ok(/no es válido: juan@/.test(validarPrograma({ ...B, destinatarios: 'juan@' }).error || ''), 'un correo malo se nombra');
ok(/Máximo 5/.test(validarPrograma({ ...B, destinatarios: 'a@a.co b@a.co c@a.co d@a.co e@a.co f@a.co' }).error || ''), 'máximo 5 destinatarios');
ok(!!validarPrograma({ ...B, destinatarios: '' }).error, 'sin destinatarios no');
ok(validarPrograma(B).programa.revisar_antes === true && validarPrograma({ ...B, revisar_antes: false }).programa.revisar_antes === false, 'revisar antes de enviar viene activado; se puede apagar');
ok(!!validarPrograma({ ...B, frecuencia: 'diaria' }).error, 'frecuencia que no existe');
ok(!!validarPrograma({ ...B, logo_url: 'http://x.com/l.png' }).error && !!validarPrograma({ ...B, logo_url: 'javascript:alert(1)' }).error, 'el logo solo por https');
ok(!!validarPrograma({ ...B, color: 'red' }).error && validarPrograma({ ...B, color: '#0f766e' }).programa.color === '#0f766e', 'color #RRGGBB');
ok(validarPrograma({ ...B, firma: 'Agencia <b>"X"</b>' }).programa.firma === 'Agencia bX/b', 'la firma no lleva < > ni comillas (va en el remitente)', validarPrograma({ ...B, firma: 'Agencia <b>"X"</b>' }).programa.firma);

console.log(mal ? `\n${mal} fallo(s)\n` : '\nTodo en orden\n');
process.exit(mal ? 1 : 0);

// Mejorar el agente (fase 1): node pruebas/mejoras-agente.mjs
//
// La validación de lo que propone el entrenador, la aplicación del cambio y el
// resumen que ve el cliente. Lo que viene del modelo no se cree: cada caso de
// abajo es una forma en que un JSON mal armado podría tocar lo que no debe.

import { readFileSync } from 'fs';
import { validarPropuesta, aplicarPropuesta, resumenDelCambio, fotoDelAgente, promptEntrenador, MAX_REGLAS, CAMPOS_AGENTE } from '../api/_mejoras-agente.js';

let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); if (!c) mal++; };

const agente = {
  id: 'a1', name: 'Aura', tone: 'formal', bienvenida: 'Hola, soy Aura',
  escalate_phrase: 'Ya te paso con un asesor', persona: 'Asesora inmobiliaria',
  business_ctx: 'Horario: lunes a viernes de 8 a 5.\nAl comprador no se le cobra comisión.',
  faqs: [{ q: '¿Dónde quedan?', a: 'En Barranquilla' }],
  reglas: [{ id: 'r1', texto: 'No digas «de nada».' }],
};
const regla = { activo: true, criterios: [{ clave: 'criterio_1', pregunta: '¿Presupuesto?', condicion: '' }], enrutado: { pregunta: '¿Comprar o arrendar?', rutas: [] } };
const AHORA = '2026-10-15T12:00:00.000Z';

console.log('\nValidar lo que devuelve el entrenador');
let v = validarPropuesta('Claro, aquí va:\n{"tipo":"regla","explicacion":"x","cambio":{"texto":"Despídete con ¡Gracias por contactarnos!"}}\nListo.', agente, regla);
ok(v.propuesta?.tipo === 'regla' && v.propuesta.cambio.texto.startsWith('Despídete'), 'saca el JSON aunque venga con texto alrededor');
ok(validarPropuesta('no sé', agente, regla).error, 'sin JSON → error');
ok(validarPropuesta('{"tipo":"borrar_todo","cambio":{}}', agente, regla).error, 'tipo desconocido → error');
ok(validarPropuesta({ tipo: 'regla', cambio: { indice: 7, texto: 'x' } }, agente, regla).error, 'editar una regla que no existe → error');
ok(validarPropuesta({ tipo: 'regla', cambio: {} }, agente, regla).error, 'regla vacía → error');
const llena = { ...agente, reglas: Array.from({ length: MAX_REGLAS }, (_, i) => ({ texto: 'r' + i })) };
ok(validarPropuesta({ tipo: 'regla', cambio: { texto: 'una más' } }, llena, regla).error, 'con ' + MAX_REGLAS + ' reglas no se agrega otra');
ok(validarPropuesta({ tipo: 'regla', cambio: { indice: 0, texto: 'editada' } }, llena, regla).propuesta, '…pero sí se puede editar una');
v = validarPropuesta({ tipo: 'regla', pregunta: '¿Cuál es el horario?', cambio: { texto: 'x' } }, agente, regla);
ok(v.propuesta?.pregunta && !v.propuesta.cambio, 'si el entrenador pregunta, no hay cambio que aplicar');
ok(validarPropuesta({ tipo: 'contexto', cambio: { buscar: 'texto que no está', reemplazar: 'y' } }, agente, regla).error, 'contexto: buscar un texto que no aparece → error (no se inventa dónde)');
ok(validarPropuesta({ tipo: 'contexto', cambio: { buscar: 'Al comprador no se le cobra comisión.', reemplazar: '' } }, agente, regla).propuesta, 'contexto: quitar una frase exacta sí');
ok(validarPropuesta({ tipo: 'calificacion', cambio: { agregar: '¿Financiación?' } }, agente, null).error, 'calificación sin regla configurada → error');
ok(validarPropuesta({ tipo: 'enrutado', cambio: { pregunta: 'x' } }, agente, { criterios: [] }).error, 'enrutado sin enrutado configurado → error');
ok(validarPropuesta({ tipo: 'tono', cambio: { valor: 'grosero' } }, agente, regla).error, 'tono fuera de formal/informal → error');
ok(validarPropuesta({ tipo: 'regla', cambio: { texto: 'x'.repeat(5000) } }, agente, regla).propuesta.cambio.texto.length === 400, 'los textos se recortan');
ok(validarPropuesta({ tipo: 'regla', cambio: { indice: '0', quitar: true } }, agente, regla).propuesta?.cambio.indice === 0, 'un índice que llega como texto se acepta como número');

console.log('\nUn fallo de Acuarius es un ticket, también de vuelta del navegador');
v = validarPropuesta({ tipo: 'fallo_plataforma', explicacion: 'e', ticket: { asunto: 'Aceptó las 12:30', detalle: 'El horario dice 8 a 5 con almuerzo' } }, agente, regla);
ok(v.propuesta?.cambio.asunto === 'Aceptó las 12:30', 'del modelo: el ticket viene en «ticket»');
const otraVez = validarPropuesta(v.propuesta, agente, regla);
ok(otraVez.propuesta?.cambio.detalle === 'El horario dice 8 a 5 con almuerzo', 'revalidado en el servidor: el detalle no se pierde');

console.log('\nAplicar no toca los originales');
const copiaAntes = JSON.stringify(agente), reglaAntes = JSON.stringify(regla);
let r = aplicarPropuesta(agente, regla, { tipo: 'regla', cambio: { texto: 'Nueva' } }, AHORA);
ok(r.agente.reglas.length === 2 && r.agente.reglas[1].texto === 'Nueva' && r.agente.reglas[1].creada_at === AHORA, 'regla nueva al final, con fecha');
ok(JSON.stringify(agente) === copiaAntes && JSON.stringify(regla) === reglaAntes, 'el agente y la regla originales quedan intactos');
r = aplicarPropuesta(agente, regla, { tipo: 'regla', cambio: { indice: 0, quitar: true } }, AHORA);
ok(r.agente.reglas.length === 0, 'quitar una regla');
r = aplicarPropuesta(agente, regla, { tipo: 'contexto', cambio: { buscar: 'Al comprador no se le cobra comisión.', reemplazar: '' } }, AHORA);
ok(!r.agente.business_ctx.includes('comisión') && r.agente.business_ctx.includes('Horario'), 'contexto: reemplaza solo el trozo exacto');
r = aplicarPropuesta(agente, regla, { tipo: 'contexto', cambio: { agregar: 'Sede en el norte.' } }, AHORA);
ok(r.agente.business_ctx.endsWith('\n\nSede en el norte.'), 'contexto: agrega al final');
r = aplicarPropuesta(agente, regla, { tipo: 'calificacion', cambio: { agregar: '¿Con qué financia la compra?' } }, AHORA);
ok(r.regla.criterios.length === 2 && r.regla.criterios[1].clave === 'criterio_2', 'calificación: criterio nuevo con clave libre');
ok(r.regla.enrutado === regla.enrutado || JSON.stringify(r.regla.enrutado) === JSON.stringify(regla.enrutado), '…sin tocar el enrutado');
r = aplicarPropuesta(agente, regla, { tipo: 'enrutado', cambio: { pregunta: '¿Comprar, arrendar, vender o dar en arriendo?' } }, AHORA);
ok(r.regla.enrutado.pregunta.includes('vender') && Array.isArray(r.regla.enrutado.rutas), 'enrutado: cambia la pregunta y conserva las rutas');
r = aplicarPropuesta(agente, regla, { tipo: 'bienvenida', cambio: { texto: '' } }, AHORA);
ok(r.agente.bienvenida === null, 'bienvenida vacía → vuelve a saludar con sus palabras');
r = aplicarPropuesta(agente, regla, { tipo: 'faq', cambio: { indice: 0, q: '¿Dónde?', a: 'Norte de Barranquilla' } }, AHORA);
ok(r.agente.faqs.length === 1 && r.agente.faqs[0].a === 'Norte de Barranquilla', 'faq: editar una existente');

console.log('\nFoto para deshacer y resumen');
const foto = fotoDelAgente(agente, regla);
ok(Object.keys(foto.agente).sort().join() === [...CAMPOS_AGENTE].sort().join(), 'la foto guarda exactamente los campos que una mejora puede tocar');
ok(!('name' in foto.agente) && !('persona' in foto.agente), 'nunca el nombre ni la identidad');
let res = resumenDelCambio(agente, regla, { tipo: 'regla', cambio: { indice: 0, texto: 'No digas «de nada»: di «con gusto».' } });
ok(res.titulo === 'Editar una regla' && res.antes === 'No digas «de nada».', 'resumen de editar: antes y después');
res = resumenDelCambio(agente, regla, { tipo: 'tono', cambio: { valor: 'informal' } });
ok(res.antes === 'Usted' && res.despues === 'Tú', 'resumen de tono legible');

console.log('\nEl prompt del entrenador');
const pe = promptEntrenador(agente, regla);
ok(pe.includes('0. No digas «de nada».') && pe.includes('¿Comprar o arrendar?'), 've las reglas y el enrutado actuales (con índice para editarlas)');
ok(/fallo_plataforma/.test(pe) && /No inventes datos del negocio/.test(pe), 'sabe distinguir un fallo nuestro y no inventa datos');

console.log('\nEl motor y el endpoint');
const motor = readFileSync(new URL('../api/_inbox-engine.js', import.meta.url), 'utf8');
ok(/REGLAS QUE TE ENSEÑÓ EL NEGOCIO/.test(motor), 'las reglas aprendidas entran al prompt del agente');
ok(/Object\.assign\(agent, agenteCambiado\)/.test(motor), 'el ensayo acepta la configuración cambiada sin guardarla');
const ep = readFileSync(new URL('../api/agente-mejorar.js', import.meta.url), 'utf8');
ok(/exigeModulo\(quien, 'agentes'\)/.test(ep), 'solo quien tiene acceso a agentes');
ok(/validarPropuesta\(body\.propuesta, agent, regla\)/.test(ep), 'la propuesta que vuelve del navegador se revalida en el servidor');
ok(/ultima\?\.id !== m\.id/.test(ep), 'deshacer solo el último cambio vigente');
ok(/origen=eq\.ensayo/.test(ep), 'probar el cambio comparte el tope diario del probador');
ok(/plan === undefined/.test(ep), 'si no se puede saber el plan, no se trata como free ni como pro');

console.log(mal ? `\n${mal} fallo(s)` : '\nTodo en verde');
process.exit(mal ? 1 : 0);

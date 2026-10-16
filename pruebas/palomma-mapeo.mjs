// Palomma → Acuarius, paso 2 (la traducción): node pruebas/palomma-mapeo.mjs
//
// Las decisiones de Alejandro (13 y 15-10-2026) y los datos reales de Certain.

import { readFileSync } from 'fs';
import { embudoIgnorado, tableroDe, etapaDe, notaDeEstado, resumenDePerfil, telefonoDe, telefonoDeConversacion, estaCalificado } from '../api/_palomma.js';

let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); if (!c) mal++; };

console.log('\nEmbudos y tableros');
ok(['Mantenimiento', 'Administrativo', 'Cartera'].every(embudoIgnorado), 'Mantenimiento, Administrativo y Cartera se ignoran');
ok(!embudoIgnorado('Comercial') && !embudoIgnorado('Captación'), 'Comercial y Captación no');
ok(tableroDe({ pipelineName: 'Comercial', profile: { listingType: 'rent' } }) === 'arriendo', 'arriendo → Arriendo');
ok(tableroDe({ pipelineName: 'Comercial', profile: { listingType: 'sale' } }) === 'venta', 'venta → Venta');
ok(tableroDe({ pipelineName: 'Comercial', profile: { listingType: 'rent_and_sale' } }) === 'arriendo', '«rent_and_sale» (dato real de Certain) → Arriendo');
ok(tableroDe({ pipelineName: 'Captación', profile: { listingType: 'rent' } }) === 'captacion', 'embudo de captación → Captación, aunque diga arriendo');
ok(tableroDe({ pipelineName: 'sourceproperties' }) === 'captacion', 'también con su nombre interno «sourceproperties»');
ok(tableroDe({ pipelineName: 'Comercial' }) === null, 'sin perfil todavía no se sabe (entra al principal y se mueve cuando se sepa)');

console.log('\nEtapas: solo estas mueven; el resto es nota');
ok(etapaDe('appointmentIntent') === 'contactado', 'intención de cita → Cliente contactado');
ok(etapaDe('appointmentPending') === 'propuesta', 'pre-cita → Cita de inmueble');
ok(etapaDe('redirected') === 'contactado', 'pasado a asesor → Cliente contactado');
for (const e of ['discarded', 'inactive', 'closed', 'appointmentConfirmed', 'appointmentCancelled', 'new', 'answered']) ok(etapaDe(e) === null, e + ' no mueve de etapa');

console.log('\nNotas');
ok(/descartó.*Motivo: no califica/.test(notaDeEstado('discarded', { lead: { discardedReason: 'no califica' } })), 'descartado: nota con el motivo (no pasa a perdido)');
ok(/inactiva/.test(notaDeEstado('inactive', {})), 'inactivo: nota');
ok(/cerrado/.test(notaDeEstado('closed', {})), 'cerrado: nota (no pasa a ganado)');
ok(/pasó la conversación a Monica Palacios\. Motivo: quiere negociar/.test(notaDeEstado('redirected', { lead: { transferReason: 'quiere negociar' }, employeeAssigned: { name: 'Monica Palacios' } })), 'pasado a asesor: con quién y por qué');
const n = notaDeEstado('appointmentPending', { appointment: { startAt: '2026-10-16T10:00:00-05:00', listingCode: 'AP-1042', branchName: 'Sede Norte' }, employeeAssigned: { name: 'Deisy Pacheco' } });
ok(/viernes, 16 de octubre.*10:00.*AP-1042.*Sede Norte.*Deisy Pacheco/.test(n), 'cita: fecha en hora de Colombia, inmueble, sede y asesor', n);
ok(notaDeEstado('new', {}) === null, 'los estados iniciales no dejan nota');

console.log('\nPerfil y teléfono');
ok(resumenDePerfil({ listingType: 'rent', propertyTypes: ['apartment'], neighborhoods: ['Alto Prado'], cities: ['Barranquilla'], bedrooms: 3, price: { max: 4000000 } }) ===
  'arriendo · apartamento · en Alto Prado · Barranquilla · 3 hab · hasta $4.000.000', 'lo que busca, en una línea');
ok(resumenDePerfil(null) === '', 'sin perfil, vacío');
ok(telefonoDe({ phone: '573001234567' }) === '+573001234567', 'teléfono de Palomma → con +');
ok(telefonoDe({}) === null, 'sin teléfono (WhatsApp ya no siempre lo da) → null');

console.log('\nSolo los calificados (Alejandro, 16-10)');
ok(['redirected', 'appointmentIntent', 'appointmentPending', 'appointmentConfirmed', 'propertyInfoCollected'].every(e => estaCalificado({ pipelinePositionId: e })), 'pasado a asesor, cita o datos del inmueble → calificado');
ok(['new', 'answered', 'inactive', 'discarded', 'closed'].every(e => !estaCalificado({ pipelinePositionId: e })), 'nuevo, contestó, inactivo, descartado o cerrado → NO');
ok(estaCalificado({ pipelinePositionId: 'answered' }, { employeeAssigned: { name: 'Jose Hurtado' } }), 'si Palomma le asignó asesor, también');

console.log('\nEl teléfono que la persona dio en el chat (WhatsApp por usuario, sin número)');
const chat = 'Agente: ¿me compartes por favor tu nombre y tu número de teléfono (ej. 3001234567) para contactarte?\n\nUsuario: MELISSA 3017031201\n\nAgente: gracias';
ok(telefonoDeConversacion(chat) === '+573017031201', 'Melissa Torres (dato real): sale su número, no el de ejemplo del agente');
ok(telefonoDe({ whatsappUserId: 'CO.1394851425705520', conversation: { content: chat } }) === '+573017031201', 'sin campo phone, se toma del chat');
ok(telefonoDe({ phone: '573225984142', conversation: { content: 'Usuario: mi número es 310 362 4956' } }) === '+573225984142', 'si Palomma trae el campo, manda el campo');
ok(telefonoDeConversacion('Usuario: +57 300-834-2960\n\nAgente: ok\n\nUsuario: perdón, es 3008342961') === '+573008342961', 'con separadores o +57; si se corrige, el último');
ok(telefonoDeConversacion('Usuario: el inmueble 121512563 me interesa\n\nAgente: el 3001234567') === null, 'un código de inmueble no es un teléfono, y lo del agente no cuenta');

console.log('\nReglas del procesador');
const p = readFileSync(new URL('../api/_palomma-proceso.js', import.meta.url), 'utf8');
ok(/if \(cx && !cx\.conexion\.procesar\) continue;/.test(p), 'con el interruptor apagado, los eventos se quedan pendientes');
ok(/pb != null && \(pa == null \|\| pb > pa\)/.test(p), 'la etapa solo avanza, nunca retrocede');
ok(/!lead\.closed_at && !\['ganado', 'perdido'\]\.includes\(lead\.stage\)/.test(p), 'y nunca toca un lead cerrado');
ok(/emp && !lead\.assigned_to/.test(p), 'el asesor de Palomma solo se pone si el lead no tiene dueño');
ok(/sinAsignar: !asesor/.test(p), 'sin asesor en Palomma, el lead entra sin asignar');
ok(/ev\.ts < enlace\.ultimo_ts/.test(p), 'un evento viejo que llega tarde no mueve nada');
ok(/endsWith\(tel\)/.test(p) && /return \{ leadId: existente\.id, creado: false \}/.test(p), 'si ya existe en Acuarius (teléfono o correo), se enlaza y no se crea otro');
ok(/nota_conversacion_id/.test(p), 'la conversación es UNA nota que se actualiza, no una por evento');
ok(/citaAGoogle\(conexion, act\)/.test(p), 'la cita nueva se sube a Google Calendar si la cuenta lo tiene conectado');
ok(/gcal_event_id=is\.null/.test(p) && /due_at=gt\./.test(p), 'las que quedaron sin subir (calendario conectado después) se suben solas, solo las futuras');
ok(/palomma\.cita a Google Calendar/.test(p), 'un fallo de Google queda registrado y no tumba el evento');

ok(/if \(!enlace && !estaCalificado\(L, data\)\) return 'esperando calificación'/.test(p), 'un contacto que Palomma no ha calificado no entra a Acuarius');
ok(/telefonoDe\(L\) \|\| ''\)\.replace/.test(p), 'el cruce con leads existentes usa también el teléfono del chat');
ok(/telNuevo && !lead\.phone/.test(p), 'a un lead sin teléfono se le completa; uno que ya lo tiene no se toca');

console.log(mal ? `\n${mal} fallo(s)` : '\nTodo en verde');
process.exit(mal ? 1 : 0);

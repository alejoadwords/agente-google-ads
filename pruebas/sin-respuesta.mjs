// «Nadie le respondió»: node pruebas/sin-respuesta.mjs
//
// El texto del aviso y las reglas del detector (api/_sin-respuesta.js y la
// función conversaciones_sin_respuesta de sql/mejoras_agente.sql).
import { readFileSync } from 'fs';
import { textoDelAviso } from '../api/_sin-respuesta.js';

let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); if (!c) mal++; };
const AHORA = Date.parse('2026-10-16T15:00:00Z');

console.log('\nEl aviso');
let a = textoDelAviso({ status: 'bot', contact_name: 'Melissa', ultimo_at: '2026-10-16T14:48:00Z', ultimo_texto: 'si, me interesa el de Miramar [CAPTURA: x=y]' }, AHORA);
ok(a.titulo === 'El agente no le respondió a Melissa', 'si la conversación es del agente, lo dice así', a.titulo);
ok(/hace 12 min/.test(a.texto) && /«si, me interesa el de Miramar»/.test(a.texto) && !/CAPTURA/.test(a.texto), 'cuánto lleva esperando y qué dijo, sin bloques ocultos');
ok(/Respóndele tú/.test(a.texto), 'y qué hacer: contestar ya');
a = textoDelAviso({ status: 'human', contact_phone: '+573001112233', ultimo_at: '2026-10-16T13:00:00Z', ultimo_texto: '¿siguen ahí?' }, AHORA);
ok(a.titulo === 'Nadie le ha respondido a +573001112233' && /hace 2 horas/.test(a.texto), 'escalada sin respuesta: otro texto; sin nombre, el teléfono');

console.log('\nLas reglas');
const sql = readFileSync(new URL('../sql/mejoras_agente.sql', import.meta.url), 'utf8');
ok(/c\.status = 'bot' and a\.is_active and u\.created_at < now\(\) - interval '10 minutes'/.test(sql), 'del agente: 10 minutos y solo si el agente está encendido (apagado no es un fallo)');
ok(/c\.status = 'human' and u\.created_at < now\(\) - interval '30 minutes'/.test(sql), 'escalada: 30 minutos');
ok(/u\.role = 'user'/.test(sql), 'solo si lo último es de la persona (cupo agotado o un aviso del sistema ya cuentan como respuesta)');
ok(/u\.created_at > now\(\) - interval '24 hours'/.test(sql), 'solo las últimas 24 h: después avisa cron-ventana');
ok(/sin_respuesta_aviso_at < u\.created_at/.test(sql), 'una vez por mensaje de la persona');
const js = readFileSync(new URL('../api/_sin-respuesta.js', import.meta.url), 'utf8');
ok(/donde: 'agente\.sin_respuesta'/.test(js), 'que el agente no responda es un fallo nuestro: va a error_log');
ok(/metadata: \{ sistema: true, evento: 'sin_respuesta', conversation_id: c\.id, para/.test(js) && /enviarPushA\(para/.test(js) && /correoA\(com/.test(js), 'aviso por campana, celular y correo a quien tiene el lead');
ok(/'\/conversaciones\?c=' \+ c\.id/.test(js), 'el enlace abre la conversación (mismo formato que el resto de avisos)');
ok(/sin_respuesta_aviso_at: new Date\(\)\.toISOString\(\)[\s\S]*registrarError/.test(js), 'se marca antes de avisar: nunca un aviso repetido cada 10 minutos');
const cron = readFileSync(new URL('../api/cron-revisor-agente.js', import.meta.url), 'utf8');
ok(/detectarSinRespuesta\(/.test(cron) && cron.indexOf('detectarSinRespuesta(') < cron.indexOf('revisarPendientes('), 'corre cada 10 min, antes que el revisor (lo urgente primero)');

console.log(mal ? `\n${mal} fallo(s)` : '\nTodo en verde');
process.exit(mal ? 1 : 0);

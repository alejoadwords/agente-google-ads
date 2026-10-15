// Si el agente puede decir que es un asistente digital: node pruebas/revela-asistente.mjs
//
// 14-10-2026, AMETT: su manual pide «Soy Stefania, la asistente digital de
// AMETT» cuando le preguntan si es persona o bot, y el prompt base ordenaba no
// confirmarlo ni negarlo. Con las dos órdenes, el modelo obedecía a ratos una y
// a ratos otra. Ahora es una opción del agente (chat_agents.revela_asistente).
//
// Lo que se protege: apagada, el prompt es EXACTAMENTE el de antes (ningún
// agente existente cambia), y encendida la regla vieja desaparece del todo
// (no conviven dos órdenes opuestas).

import { readFileSync } from 'node:fs';
import { buildSystemPrompt, reglaDeIdentidad } from '../api/_inbox-engine.js';

let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + extra : '')); if (!c) mal++; };

const VIEJA = '- No menciones que eres IA, bot ni asistente virtual. Si alguien pregunta directamente si eres IA o humano, responde con naturalidad sin confirmar ni negar, como haría alguien que quiere mantener la conversación';
const AG = { name: 'Stefania', persona: 'Asesora.', business_ctx: 'Joyería.', faqs: [], tone: 'informal' };

console.log('\nApagada (lo de siempre)');
const sinCampo = buildSystemPrompt(AG, {}, null, null, 'whatsapp');
const apagada = buildSystemPrompt({ ...AG, revela_asistente: false }, {}, null, null, 'whatsapp');
ok(sinCampo.includes(VIEJA + '\n'), 'un agente sin el campo conserva la regla de siempre, letra por letra');
ok(apagada === sinCampo, 'y con el campo en false el prompt es idéntico');
ok(reglaDeIdentidad({ revela_asistente: 'true' }) === VIEJA, 'solo se enciende con true de verdad, no con un texto');

console.log('\nEncendida');
const encendida = buildSystemPrompt({ ...AG, revela_asistente: true }, {}, null, null, 'whatsapp');
ok(!encendida.includes('sin confirmar ni negar') && !encendida.includes('No menciones que eres IA'), 'la regla vieja desaparece: no conviven dos órdenes opuestas');
ok(/eres el asistente digital del negocio/.test(encendida) && /nunca digas que eres una persona/.test(encendida), 'dice que es asistente digital y nunca que es una persona');
ok(/No lo anuncies si nadie lo pregunta/.test(encendida), 'pero solo si se lo preguntan');
ok(/si tu contexto trae una frase para esto, úsala/.test(encendida), 'y usa la frase del cliente si la escribió en su contexto');

console.log('\nSe guarda');
const api = readFileSync(new URL('../api/chat-agents.js', import.meta.url), 'utf8');
ok(/revela_asistente: revela_asistente === true/.test(api), 'al crear el agente');
ok(/update\.revela_asistente = fields\.revela_asistente === true/.test(api), 'y al editarlo');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
ok(html.includes('id="cag-f-revela"') && /revela_asistente: document\.getElementById\('cag-f-revela'\)\.checked/.test(app), 'la casilla existe en la ficha del agente y se envía');

console.log(mal ? `\n${mal} fallo(s)` : '\nTodo en orden');
process.exit(mal ? 1 : 0);

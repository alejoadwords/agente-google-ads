// Un mensaje nuevo reabre la conversación: node pruebas/conversacion-reabre.mjs
//
// Si el cliente vuelve a escribir, la conversación ya no está resuelta ni
// archivada. Hay DOS caminos de entrada en processIncoming y los dos tienen que
// hacerlo: el de atención manual sale antes que el del agente, y por eso el
// desarchivado se quedó fuera del manual la primera vez (06-10-2026).
//
//   · Manual («Mi equipo» o ya escalada): resuelta → human («Manual»).
//   · Con agente: resuelta → bot («Agente IA»), que es quien va a contestar.
//   · En los dos: archivada_at → null.

import { readFileSync } from 'node:fs';
const motor = readFileSync(new URL('../api/_inbox-engine.js', import.meta.url), 'utf8');

let mal = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) mal++; };

const iManual = motor.indexOf("if (aMano || conv.status === 'human') {");
const iAgente = motor.indexOf('const msgRows = await fetch(', iManual);
ok(iManual > 0 && iAgente > iManual, 'existen los dos caminos, el manual primero');

console.log('\nCamino manual');
const manual = motor.slice(iManual, iManual + 2200);
ok(/archivada_at: null/.test(manual), 'desarchiva');
ok(/conv\.status === 'resolved' \? \{ status: 'human' \}/.test(manual), 'una resuelta vuelve a «Manual» (human)');

console.log('\nCamino del agente');
const agente = motor.slice(iAgente, iAgente + 1400);
ok(/archivada_at: null/.test(agente), 'desarchiva');
ok(/conv\.status === 'resolved' \? \{ status: 'bot' \}/.test(agente), 'una resuelta vuelve al agente (bot)');

console.log(mal ? `\n${mal} fallo(s)` : '\nTodo en verde');
process.exit(mal ? 1 : 0);

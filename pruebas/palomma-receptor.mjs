// Receptor de Palomma, paso 1: node pruebas/palomma-receptor.mjs
//
// Lo que no puede fallar: aceptar a Palomma, rechazar a cualquier otro y no
// perder ni duplicar un aviso (Palomma no reintenta).

import { sha256Hex, igualesSeguro, secretoValido, filaDeEvento } from '../api/_palomma.js';

let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); if (!c) mal++; };

console.log('\nSecreto compartido');
{
  const conexion = { secreto_hash: await sha256Hex('secreto-bueno'), secreto_hash_anterior: null };
  ok(await secretoValido('secreto-bueno', conexion), 'acepta el secreto correcto');
  ok(!(await secretoValido('secreto-malo', conexion)), 'rechaza otro secreto');
  ok(!(await secretoValido('', conexion)) && !(await secretoValido(null, conexion)), 'rechaza sin header');
  const rotando = { secreto_hash: await sha256Hex('nuevo'), secreto_hash_anterior: await sha256Hex('viejo') };
  ok(await secretoValido('viejo', rotando) && await secretoValido('nuevo', rotando), 'durante una rotación acepta el anterior y el nuevo');
  ok(!(await secretoValido('viejo', { ...rotando, secreto_hash_anterior: null })), 'terminada la rotación, el anterior ya no entra');
  ok(igualesSeguro('abc', 'abc') && !igualesSeguro('abc', 'abd') && !igualesSeguro('abc', 'abcd'), 'comparación segura');
  ok((await sha256Hex('x')).length === 64, 'el hash es SHA-256 en hex');
}

console.log('\nQué se guarda de cada aviso');
{
  const conexion = { id: 'c1', user_id: 'user_x' };
  const ev = { type: 'lead.status-updated', timestamp: '2026-09-11T14:12:30.771Z', data: { lead: { id: '01K4T8ZJ2QW9F3X6R2Y7B5C1D8', pipelinePositionId: 'redirected' } } };
  const { fila, error } = filaDeEvento(ev, conexion);
  ok(!error && fila.tipo === 'lead.status-updated' && fila.palomma_lead_id === '01K4T8ZJ2QW9F3X6R2Y7B5C1D8', 'tipo y lead de Palomma', fila);
  ok(fila.ts === '2026-09-11T14:12:30.771Z', 'el timestamp tal cual: con tipo y lead es la clave anti-duplicados');
  ok(fila.payload === ev, 'guarda el evento entero, sin interpretarlo (eso es el paso 2)');
  ok(fila.conexion_id === 'c1' && fila.user_id === 'user_x', 'queda atado a la cuenta de la conexión, no a lo que diga el cuerpo');
  ok(filaDeEvento({ type: 'x', timestamp: 't', data: { lead: { id: 'L' } }, user_id: 'otro' }, conexion).fila.user_id === 'user_x', 'un user_id dentro del cuerpo se ignora');
  ok(filaDeEvento(null, conexion).error, 'cuerpo vacío se rechaza');
  ok(filaDeEvento([], conexion).error, 'un arreglo no es un evento');
  ok(filaDeEvento({ data: { lead: { id: 'L' } } }, conexion).error === 'falta type', 'sin type se rechaza');
  ok(filaDeEvento({ type: 'lead.created', data: {} }, conexion).error === 'falta data.lead.id', 'sin lead.id se rechaza (es la llave de todo)');
  ok(filaDeEvento({ type: 'lead.created', data: { lead: { id: 'L' } } }, conexion).fila.ts === null, 'sin timestamp se guarda igual');
}

console.log(mal ? `\n${mal} fallo(s)` : '\nTodo en verde');
process.exit(mal ? 1 : 0);

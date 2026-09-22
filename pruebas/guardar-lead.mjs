// Guardar un contacto dice QUÉ falló: node pruebas/guardar-lead.mjs
//
// El cliente reportó «a algunos asesores les sale error al crear un contacto»
// y no hubo forma de saber cuál: el botón ponía «Error — reintentar» y ya. El
// código hacía `throw new Error()` pelado, así que el motivo del servidor se
// tiraba, y `fetchAuth` solo anota 5xx: un 400 o un 403 no dejaban ni rastro
// en el registro de errores.
//
// Esto EJECUTA el guardado contra respuestas de mentira y comprueba las dos
// cosas: que el usuario ve el motivo y que queda anotado para soporte.

import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const trozo = (desde, hasta) => {
  const a = js.indexOf(desde);
  if (a < 0) throw new Error('No encontré en app.js: ' + desde);
  return js.slice(a, js.indexOf(hasta, a));
};

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

const campos = {};
const aviso = { textContent: '', style: {} };
const boton = { textContent: '', disabled: false };
globalThis.document = {
  getElementById: (id) => id === 'crm-modal-aviso' ? aviso
    : id === 'crm-save-btn' ? boton
    : (campos[id] = campos[id] || { value: '', classList: { add() {}, remove() {} }, focus() {} }),
};
const anotados = [];
globalThis.errRegistrar = (mensaje, donde) => anotados.push({ mensaje, donde });

let respuesta = null;
globalThis.fetchAuth = async () => respuesta;
const resp = (status, cuerpo) => ({
  ok: status < 400, status,
  clone() { return this; },
  json: async () => cuerpo,
  text: async () => JSON.stringify(cuerpo),
});

const codigo = [
  trozo('async function crmSaveLead()', '\n// ── Panel de detalle'),
  'var crmEditingId = "l1", crmLeads = [{ id: "l1" }], agencyActiveClientId = null;',
  'var crmPipelineActivo = null, crmPipelineId = null, crmStages = [];',
  'function crmNormalizarTelefono() {} function crmCloseModal() {} function crmRender() {}',
  'function crmAvisarTagsIgnoradas() {} function track() {} function closeOpenModal() {}',
  'function citaAbrir() { return false } function crmIsWonStage() { return false }',
  'function crmIsLostStage() { return false } function crmNombreResponsable() { return null }',
  'function openUpgradeFlow() {} function lfPintar() {}',
  'var lfLead = null, crmDetailLead = null, userPlan = "agency";',
  'return crmSaveLead;',
].join('\n');
const crmSaveLead = new Function(codigo)();

campos['crm-f-name'] = { value: 'Contacto de prueba', focus() {} };

console.log('\nUn fallo del servidor dice el motivo\n');
{
  respuesta = resp(400, { error: 'El teléfono no tiene un formato válido' });
  aviso.textContent = ''; anotados.length = 0;
  await crmSaveLead();
  chk('el motivo se le enseña a quien guarda',
      /formato válido/.test(aviso.textContent), JSON.stringify(aviso.textContent));
  chk('y el aviso se ve', aviso.style.display === 'block', aviso.style.display);
  chk('el botón invita a reintentar, sin fingir que fue bien', boton.textContent === 'Reintentar', boton.textContent);
  chk('se puede volver a pulsar', boton.disabled === false);
  // Esto es lo que faltó hoy: un 400 no llegaba al registro y no había NADA
  // que mirar cuando el cliente escribió.
  chk('queda anotado para soporte, aunque sea un 4xx',
      anotados.length === 1 && /HTTP 400/.test(anotados[0].mensaje) && anotados[0].donde === '/api/leads',
      JSON.stringify(anotados));
}

console.log('\nSin cuerpo que leer, tampoco se queda mudo\n');
{
  respuesta = { ok: false, status: 502, clone() { return this; },
    json: async () => { throw new Error('no es json'); }, text: async () => '' };
  aviso.textContent = ''; anotados.length = 0;
  await crmSaveLead();
  chk('dice al menos qué respondió el servidor',
      /502/.test(aviso.textContent), JSON.stringify(aviso.textContent));
  // Los 5xx ya los anota fetchAuth: anotarlos otra vez sería duplicar.
  chk('y un 5xx no se anota dos veces', anotados.length === 0, JSON.stringify(anotados));
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);

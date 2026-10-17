// pruebas/tareas-cliente-del-lead.mjs
//
// Una tarea o cita con lead lleva el cliente DE SU LEAD (17-10-2026). La
// revisión diaria avisó de tareas de Certain sin cliente: Palomma pasaba al
// reparto un lead leído sin `client_id`, y la agenda guardaba el cliente
// elegido en la pantalla («Mi cuenta» = ninguno). Así no salían en el
// calendario de Certain ni en Productividad. Se protege:
//
//   1. crearTareaPrimerContacto busca el cliente si el lead llega sin él.
//   2. Palomma lee el cliente del lead.
//   3. La agenda toma el cliente del lead al crear y al cambiar de lead.
//   4. Las tareas de automatización, el del lead.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (f) => readFileSync(join(RAIZ, f), 'utf8');
let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (c || extra === undefined ? '' : ' → ' + extra)); if (!c) mal++; };

process.env.SUPABASE_URL = 'https://sb.test';
process.env.SUPABASE_SERVICE_KEY = 'k';

console.log('\nLa tarea de primer contacto\n');
{
  const creadas = [];
  globalThis.fetch = async (u, o = {}) => {
    const url = String(u), metodo = o.method || 'GET';
    let filas = [];
    if (url.includes('user_profiles')) filas = [{ profile_data: { primer_contacto: true, titulo: 'Primer contacto', horas: 1 } }];
    else if (metodo === 'GET' && url.includes('/leads?id=eq.L1')) filas = [{ client_id: 'pro_main' }];
    else if (metodo === 'POST' && url.includes('/activities')) { creadas.push(JSON.parse(o.body)); filas = [{ id: 'T1', ...JSON.parse(o.body) }]; }
    const txt = JSON.stringify(filas);
    return { ok: true, status: 200, json: async () => filas, text: async () => txt, headers: { get: () => null } };
  };
  const { crearTareaPrimerContacto } = await import('../api/_followup.js');
  // Como lo pasaba Palomma: sin la columna client_id.
  await crearTareaPrimerContacto('u1', { id: 'L1', name: 'Daniela Diaz', source: 'palomma' }, { id: 'c1', nombre: 'Deysy' });
  ok(creadas.length === 1, 'se crea la tarea');
  ok(creadas[0]?.client_id === 'pro_main', 'con el cliente de su lead, aunque quien llama no lo pasara', JSON.stringify(creadas[0]?.client_id));
  creadas.length = 0;
  await crearTareaPrimerContacto('u1', { id: 'L2', name: 'Otra', client_id: null }, null);
  ok(creadas[0] && creadas[0].client_id === null, 'un lead que de verdad no tiene cliente deja la tarea sin cliente (no se inventa uno)');
}

console.log('\nLos que crean tareas\n');
{
  ok(/select=id,client_id,name,email,phone,stage,pipeline_id,assigned_to/.test(leer('api/_palomma-proceso.js')), 'Palomma lee el cliente del lead que manda al reparto');
  const agenda = leer('api/agenda.js');
  ok(/client_id: clienteDeLaTarea,/.test(agenda) && /clienteDeLaTarea = lr\[0\]\.client_id \|\| null;/.test(agenda), 'la agenda guarda el cliente del lead, no el de la pantalla');
  ok(/if \(!lr\.length\) return jsonResp\(\{ error: 'Ese lead no es de esta cuenta\.' \}, 404\);/.test(agenda), 'y el lead tiene que ser de la cuenta');
  ok(/clienteDelMiembro && clienteDeLaTarea !== clienteDelMiembro/.test(agenda), 'un miembro acotado a un cliente no crea en otro');
  ok(/if \(update\.lead_id\) \{[\s\S]{0,900}update\.client_id = lr\[0\]\.client_id \|\| null;/.test(agenda), 'al cambiar la tarea de lead, el cliente va con él');
  ok(/client_id: lead\.client_id !== undefined \? lead\.client_id : auto\.client_id/.test(leer('api/cron-automations.js')), 'las tareas de automatización, con el cliente del lead');
}

console.log(mal ? `\n${mal} fallo(s)\n` : '\nTodo en orden\n');
process.exit(mal ? 1 : 0);

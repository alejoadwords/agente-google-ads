// pruebas/bienvenida-por-persona.mjs
//
// Las automatizaciones son por oportunidad, pero la misma persona no recibe
// dos bienvenidas el mismo día (decisión de Alejandro, 17-10-2026). Se protege:
//
//   1. Un flujo de «lead nuevo» no le escribe si otra oportunidad suya ya
//      recibió la bienvenida en las últimas 24 horas.
//   2. Solo cuentan los mensajes de bienvenida de OTRA oportunidad suya, no
//      los de la misma ni los de otros flujos.
//   3. Si no se puede comprobar, se manda (perder una bienvenida es peor).
//   4. Los trabajos de la misma persona corren en fila, y lo enviado en la
//      vuelta cuenta aunque la bitácora aún no se haya escrito.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (f) => readFileSync(join(RAIZ, f), 'utf8');
let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (c || extra === undefined ? '' : ' → ' + extra)); if (!c) mal++; };

process.env.SUPABASE_URL = 'https://sb.test';
const A = await import('../api/cron-automations.js');

// Una base de mentira: grupos de oportunidades, flujos de bienvenida y registro.
function base({ grupos, bienvenidas, enviados }) {
  const pedidas = [];
  const consultar = async (ruta) => {
    pedidas.push(ruta);
    if (ruta.startsWith('/leads?')) {
      const g = ruta.match(/id\.eq\.([^,]+),contacto_id/)[1];
      return (grupos[g] || []).map(id => ({ id }));
    }
    if (ruta.startsWith('/automations?')) return bienvenidas.map(id => ({ id }));
    if (ruta.startsWith('/automation_logs?')) {
      const leads = ruta.match(/lead_id=in\.\(([^)]*)\)/)[1].split(',');
      const autos = ruta.match(/automation_id=in\.\(([^)]*)\)/)[1].split(',');
      return enviados.filter(e => leads.includes(e.lead) && autos.includes(e.auto)).map(() => ({ id: 1 }));
    }
    throw new Error('ruta ' + ruta);
  };
  return { consultar, pedidas };
}

console.log('\nUna bienvenida por persona al día\n');
{
  const b = base({ grupos: { G1: ['G1', 'L2'] }, bienvenidas: ['BIEN-VENTA', 'BIEN-ARRIENDO'], enviados: [{ lead: 'G1', auto: 'BIEN-VENTA' }] });
  ok(await A.otraBienvenidaReciente({ id: 'L2', contacto_id: 'G1' }, 'u1', b.consultar) === true,
     'entró a Arriendo el mismo día que a Venta y ya tuvo la bienvenida de Venta: la de Arriendo no le escribe');
  ok(b.pedidas.some(r => /created_at=gte\./.test(r)) && b.pedidas.some(r => /result=eq\.sent/.test(r)), 'mira solo lo ENVIADO en las últimas 24 horas');
}
{
  const b = base({ grupos: { G3: ['G3'] }, bienvenidas: ['BIEN'], enviados: [] });
  ok(await A.otraBienvenidaReciente({ id: 'G3', contacto_id: null }, 'u1', b.consultar) === false, 'una persona con una sola oportunidad recibe su bienvenida');
  ok(!b.pedidas.some(r => r.startsWith('/automation_logs')), 'y ni se consulta el registro');
}
{
  const b = base({ grupos: { G4: ['G4', 'L5'] }, bienvenidas: ['BIEN'], enviados: [{ lead: 'G4', auto: 'OTRO-FLUJO' }] });
  ok(await A.otraBienvenidaReciente({ id: 'L5', contacto_id: 'G4' }, 'u1', b.consultar) === false, 'un mensaje de otro flujo (no de bienvenida) no cuenta');
}
{
  const b = base({ grupos: { G6: ['G6', 'L7'] }, bienvenidas: ['BIEN'], enviados: [{ lead: 'L7', auto: 'BIEN' }] });
  ok(await A.otraBienvenidaReciente({ id: 'L7', contacto_id: 'G6' }, 'u1', b.consultar) === false, 'lo enviado a la MISMA oportunidad no cuenta: cada flujo sigue su curso');
}
{
  const b = base({ grupos: { G8: ['G8', 'L9'] }, bienvenidas: [], enviados: [] });
  ok(await A.otraBienvenidaReciente({ id: 'L9', contacto_id: 'G8' }, 'u1', b.consultar) === false, 'sin flujos de bienvenida no hay nada que evitar');
}
{
  const falla = async () => { throw new Error('Supabase 503'); };
  ok(await A.otraBienvenidaReciente({ id: 'X1', contacto_id: 'GX' }, 'u1', falla) === false, 'si no se puede comprobar, se manda');
}

console.log('\nEl motor\n');
{
  const m = leer('api/cron-automations.js');
  ok(/if \(contactaAlLead && auto\.trigger\?\.type === 'lead_created' && await otraBienvenidaReciente\(lead, auto\.user_id\)\)/.test(m),
     'solo los flujos de «lead nuevo», y solo sus pasos que le escriben a la persona');
  ok(/'skipped', 'La persona ya recibió hoy la bienvenida de otra de sus oportunidades/.test(m), 'y queda en el registro por qué no salió');
  ok(/if \(result === 'sent' && PASOS_DE_CONTACTO\.has\(action\)\) _enviosEnVuelta\.push/.test(m), 'lo enviado en esta vuelta cuenta aunque la bitácora aún no se haya escrito');
  ok(/const clave = \(l && \(l\.contacto_id \|\| l\.id\)\) \|\| j\.lead_id;/.test(m), 'los trabajos de la misma persona corren en fila, no en paralelo');
  ok(/_enviosEnVuelta\.length = 0; _hermanosDe\.clear\(\); _bienvenidasDe\.clear\(\);/.test(m), 'y lo de la vuelta anterior no se arrastra');
}

console.log(mal ? `\n${mal} fallo(s)\n` : '\nTodo en orden\n');
process.exit(mal ? 1 : 0);

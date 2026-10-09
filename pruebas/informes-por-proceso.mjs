// pruebas/informes-por-proceso.mjs
//
// El selector de proceso de la cabecera se veía en Análisis pero no filtraba
// nada (Certain, 09-10-2026): los informes sumaban todos los procesos y al
// cambiarlo se repintaba el tablero oculto. Y el Resumen no tenía fechas.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(join(RAIZ, 'public/app.js'), 'utf8');
let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (c || extra === undefined ? '' : ' → ' + extra)); if (!c) mal++; };
const trozo = (firma) => { const i = app.indexOf(firma); return i < 0 ? '' : app.slice(i, app.indexOf('\n}\n', i) + 3); };

// Las funciones de verdad, sobre un estado de mentira.
const mundo = new Function('estado', `
  let crmPipelines = estado.pipelines, crmPipelineId = estado.actual, crmView = estado.vista;
  let _informeTodos = estado.todos;
  const VISTAS_INFORME = ['analytics', 'sales', 'prod', 'mk', 'equipo'];
  ${trozo('function enInforme(')}
  ${trozo('function informeTodos(')}
  ${trozo('function informePipelineId(')}
  ${trozo('function soloDelProceso(')}
  ${trozo('function actsDelProceso(')}
  return { soloDelProceso, actsDelProceso, informePipelineId, enInforme };
`);

const PIPES = [{ id: 'arr', name: 'Arriendo', is_default: true }, { id: 'cap', name: 'Captación' }];
const LEADS = [
  { id: 'a1', pipeline_id: 'arr' }, { id: 'a2', pipeline_id: null },
  { id: 'c1', pipeline_id: 'cap' }, { id: 'c2', pipeline_id: 'cap' },
];

console.log('\nEl proceso elegido recorta los informes\n');
{
  const m = mundo({ pipelines: PIPES, actual: 'cap', vista: 'sales', todos: false });
  ok(m.soloDelProceso(LEADS).map(l => l.id).join() === 'c1,c2', 'con Captación, solo los de Captación');
  const acts = [{ lead_id: 'c1' }, { lead_id: 'a1' }, { lead_id: null }];
  ok(m.actsDelProceso(acts, m.soloDelProceso(LEADS)).length === 1, 'y sus actividades, nada más');
  const p = mundo({ pipelines: PIPES, actual: 'arr', vista: 'sales', todos: false });
  ok(p.soloDelProceso(LEADS).map(l => l.id).join() === 'a1,a2', 'en el principal entran también los leads sin proceso');
  const t = mundo({ pipelines: PIPES, actual: 'cap', vista: 'sales', todos: true });
  ok(t.soloDelProceso(LEADS).length === 4 && t.informePipelineId() === null, 'con «Todos los procesos», todos');
  const uno = mundo({ pipelines: [PIPES[0]], actual: 'arr', vista: 'sales', todos: false });
  ok(uno.soloDelProceso(LEADS).length === 4, 'con un solo proceso no se recorta nada');
  ok(mundo({ pipelines: PIPES, actual: 'cap', vista: 'analytics', todos: false }).enInforme(), 'el Resumen es un informe');
}

console.log('\nCambiar de proceso repinta el informe, no el tablero\n');
ok(/return soloMiGestion\(soloDelProceso\(todos\)\);/.test(trozo('function leadsInforme(')), 'todos los informes pasan por el recorte');
ok(/if \(enInforme\(\)\) return pipeCambiarEnInforme\(id\);/.test(trozo('async function pipeCambiar(')), 'pipeCambiar deriva a los informes');
ok(/crmSetView\(crmView\);/.test(trozo('async function pipeCambiarEnInforme(')), 'y se repinta la vista que se está mirando');
ok(/crmView === 'list' \|\| enInforme\(\)/.test(trozo('function pipeAbrirSelector(')), '«Todos los procesos» se ofrece en los informes');
ok(/actsDelProceso\(actsDeMisLeads\(actsTodas, leads\), leads\)/.test(app), 'Productividad cuenta las actividades del proceso');

console.log('\nEl Resumen tiene fechas\n');
const res = trozo('function crmRenderAnalytics(');
ok(/rangoBotones\(_resumenRange, 'resumenSetRange'\)/.test(res), 'la botonera de fechas de los demás informes');
ok(/t >= desdeR && t <= hastaR/.test(res) && /l\.created_at/.test(res), 'cuenta los leads que entraron en el periodo');
ok(/let _resumenRange = 0;/.test(app), '«Todo» por defecto, que es lo que enseñaba');
ok(/informeTodos\(\)\s*\?\s*\[\{ key: '__abiertos'/.test(res), 'con todos los procesos, el embudo no mezcla etapas ajenas');

console.log(mal ? `\n${mal} fallo(s)\n` : '\nTodo en orden\n');
process.exit(mal ? 1 : 0);

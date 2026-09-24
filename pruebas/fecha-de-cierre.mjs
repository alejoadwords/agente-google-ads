// pruebas/fecha-de-cierre.mjs
//
// Un negocio de Certain cerrado en agosto salía en el reporte de septiembre.
// Dos fallos encadenados:
//
//   1. El servidor NUNCA sellaba `closed_at`: solo lo escribía el modal de
//      ganada/perdida desde el navegador. Crear el lead directamente en la
//      columna de cierre —el botón «+ Agregar» está en todas, y Certain
//      renombró su etapa `ganado` a «Entrega de inmueble», así que no se
//      siente como cerrar— lo dejaba vacío. Igual una automatización, un
//      webhook o un arrastre.
//   2. El reporte, sin esa fecha, fechaba el cierre por `updated_at`: la
//      última vez que alguien tocó el lead. Cada edición lo movía de mes.
//
// Lo que se protege aquí es que ninguna de las dos vuelva.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const api = readFileSync(join(RAIZ, 'api/leads.js'), 'utf8');
const app = readFileSync(join(RAIZ, 'public/app.js'), 'utf8');

let mal = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) mal++; };

// ── El reporte ─────────────────────────────────────────────────────────
ok(!/closed_at \|\| l?\.?updated_at/.test(app),
   'ningún reporte fecha un cierre por `updated_at` — es lo que movía el lead de mes');
ok(/function fechaDeCierre\(l\)/.test(app), 'hay una sola función que decide la fecha del cierre');

const fn = new Function(
  (app.split('function fechaDeCierre(l) {')[1] || '').split('\n}\n')[0].replace(/^/, 'function f(l) {') + '\n} return f;'
)();
ok(fn({ closed_at: '2026-08-17T00:00:00Z', updated_at: '2026-09-23T14:00:00Z' }) === '2026-08-17T00:00:00Z',
   'con fecha de cierre, manda esa');
ok(fn({ closed_at: null, created_at: '2026-08-20T14:09:00Z', updated_at: '2026-09-23T14:00:00Z' }) === '2026-08-20T14:09:00Z',
   'sin ella cae en la fecha de creación — agosto, no septiembre: el caso real de Certain');
ok(fn({ closed_at: null, created_at: null, updated_at: '2026-09-23T14:00:00Z' }) === null,
   'y si no hay ninguna de las dos, no se inventa una');
ok(fn(null) === null, 'sin lead no revienta');

// ── El servidor sella la fecha ─────────────────────────────────────────
ok(/if \(update\.stage !== undefined && update\.closed_at === undefined\)/.test(api),
   'al mover de etapa, el servidor decide la fecha de cierre');
ok(/if \(cierraAhora && !prevCerrado\) update\.closed_at = update\.updated_at;/.test(api),
   'la sella al ENTRAR en una etapa de cierre, venga de donde venga');
ok(/if \(!cierraAhora && prevCerrado\) update\.closed_at = null;/.test(api),
   'y la limpia al salir: `leadCerrado()` da por cerrado a cualquiera con fecha, ' +
   'así que un lead reabierto contaría como cerrado para siempre');

const crear = (api.split('payload.expected_close_date = body.expected_close_date;')[1] || '').slice(0, 900);
ok(/ETAPAS_CERRADAS\.includes\(String\(payload\.stage[\s\S]{0,160}closed_at/.test(crear),
   'un lead que NACE en una etapa de cierre también la lleva — el «+ Agregar» está en todas las columnas');

const importar = (api.split("source: 'importacion'")[0] || '').slice(-700);
ok(/ETAPAS_CERRADAS\.includes\(String\(stage[\s\S]{0,140}closed_at/.test(importar),
   'e importar eligiendo «Ganado» como etapa inicial también cierra');

// ── Que no se escape una etapa de cierre renombrada ────────────────────
ok(/const ETAPAS_CERRADAS = \['ganado', 'perdido'/.test(api),
   'las etapas de cierre se reconocen por su clave, no por el nombre que les ponga el cliente');

process.exit(mal ? 1 : 0);

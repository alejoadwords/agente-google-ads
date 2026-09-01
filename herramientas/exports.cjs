#!/usr/bin/env node
// Comprueba que cada función de api/ tenga UN solo export default y no declare
// dos veces el mismo handler. Nació de un despliegue roto: un script de
// reemplazo masivo dejó `export default` duplicado en api/pipelines.js porque
// ese archivo ya usaba el mismo nombre de función interna que yo iba a poner.
// node --check no lo detecta: es JavaScript válido, pero el bundler lo rechaza.
const fs = require('fs'), path = require('path');
let malos = 0;
for (const f of fs.readdirSync('api').filter(x => x.endsWith('.js'))) {
  const s = fs.readFileSync(path.join('api', f), 'utf8');
  const def = (s.match(/^export default/gm) || []).length;
  const nombres = {};
  for (const m of s.matchAll(/^\s*(?:export\s+default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
    nombres[m[1]] = (nombres[m[1]] || 0) + 1;
  }
  const dobles = Object.entries(nombres).filter(([, n]) => n > 1);
  if (def > 1) { console.log(`  ${f}: ${def} export default`); malos++; }
  for (const [n, c] of dobles) { console.log(`  ${f}: la función «${n}» se declara ${c} veces`); malos++; }
}
console.log(malos ? `\n${malos} problema(s)` : 'exports de api/: sanos');
process.exit(malos ? 1 : 0);

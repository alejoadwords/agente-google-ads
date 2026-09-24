#!/usr/bin/env node
// tools/pruebas.mjs — corre la batería entera y dice qué se rompió.
//
//   node tools/pruebas.mjs              todas
//   node tools/pruebas.mjs nps          solo las que llevan «nps» en el nombre
//
// Hasta ahora las suites se corrían sueltas, una por una y a mano, así que en
// la práctica solo se ejecutaba la que uno acababa de escribir. Una batería
// que no se corre entera no protege de nada: protege del último cambio.
//
// Diez suites hablan con Supabase de verdad y esperan el directorio de un
// `.env` como segundo argumento. Las credenciales salen de Vercel y se
// escriben en un fichero temporal que se borra al terminar, pase lo que pase.
//
// OJO: `timeout` no existe en macOS, así que el corte por tiempo se hace aquí
// matando el proceso hijo.

import { readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIMITE_MS = 120000;
const filtro = process.argv[2] || '';

// El token NO va escrito aquí. La primera versión lo traía dentro y GitHub
// rechazó el push —con razón—: un fichero del repositorio es el peor sitio
// para una credencial. Sale del entorno o del llavero del Mac, igual que el de
// Supabase en `tools/soporte.mjs`.
//
//   security add-generic-password -s "Vercel Acuarius" -a vercel -w <token>
function tokenVercel() {
  if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN;
  try {
    return execSync('security find-generic-password -s "Vercel Acuarius" -a vercel -w',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    console.error('\n  Falta el token de Vercel. Ponlo en VERCEL_TOKEN, o guárdalo una vez:\n' +
      '    security add-generic-password -s "Vercel Acuarius" -a vercel -w <token>\n');
    process.exit(2);
  }
}

const VERCEL = {
  proyecto: 'prj_jsnlNLBi8HKCxtA56xhyc65SuVIY',
  equipo: 'team_AMakmLzuhAWGyZv4OjCTtWJc',
};
const NECESARIAS = [
  'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'CLERK_SECRET_KEY', 'TOKENS_KEY',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_ADS_MCC_ID', 'CRON_SECRET', 'LINK_SECRET',
];

async function entorno() {
  const cab = { Authorization: `Bearer ${tokenVercel()}` };
  const { envs } = await fetch(
    `https://api.vercel.com/v9/projects/${VERCEL.proyecto}/env?teamId=${VERCEL.equipo}`,
    { headers: cab }).then(r => r.json());
  const lineas = [];
  for (const clave of NECESARIAS) {
    const e = envs.find(x => x.key === clave);
    if (!e) continue;
    const v = await fetch(
      `https://api.vercel.com/v1/projects/${VERCEL.proyecto}/env/${e.id}?teamId=${VERCEL.equipo}`,
      { headers: cab }).then(r => r.json());
    if (v?.value) lineas.push(`${clave}=${v.value}`);
  }
  const dir = mkdtempSync(join(tmpdir(), 'acuarius-pruebas-'));
  writeFileSync(join(dir, '.env'), lineas.join('\n') + '\n');
  return { dir, cuantas: lineas.length };
}

function correr(fichero, dirEnv) {
  return new Promise(resolve => {
    const hijo = spawn('node', [join(RAIZ, 'pruebas', fichero), dirEnv], { cwd: RAIZ });
    let salida = '';
    const reloj = setTimeout(() => { hijo.kill('SIGKILL'); }, LIMITE_MS);
    hijo.stdout.on('data', d => { salida += d; });
    hijo.stderr.on('data', d => { salida += d; });
    hijo.on('close', codigo => {
      clearTimeout(reloj);
      const limpia = salida.split('\n')
        .filter(l => !/MODULE_TYPELESS|Reparsing|To eliminate|trace-warnings|^\(node:/.test(l));
      resolve({ codigo, salida: limpia.join('\n') });
    });
  });
}

const { dir, cuantas } = await entorno();
console.log(`  entorno: ${cuantas} variables\n`);

const suites = readdirSync(join(RAIZ, 'pruebas'))
  .filter(f => f.endsWith('.mjs'))
  .filter(f => !filtro || f.includes(filtro))
  .sort();

const rotas = [];
let ok = 0, comprobaciones = 0;
try {
  for (const f of suites) {
    const r = await correr(f, dir);
    comprobaciones += (r.salida.match(/✓/g) || []).length;
    if (r.codigo === 0) { ok++; process.stdout.write('.'); }
    else { rotas.push({ f, ...r }); process.stdout.write('X'); }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });   // las credenciales no se quedan en disco
}

console.log(`\n\n  ${ok}/${suites.length} suites en verde · ${comprobaciones} comprobaciones`);
if (rotas.length) {
  console.log(`\n  ── ROTAS (${rotas.length}) ─────────────────────────────`);
  for (const r of rotas) {
    console.log(`\n  ✗ ${r.f}  (código ${r.codigo === null ? 'cortada por tiempo' : r.codigo})`);
    const fallos = r.salida.split('\n').filter(l => /✗|Error|error:|FALL/.test(l)).slice(0, 4);
    for (const l of (fallos.length ? fallos : r.salida.split('\n').slice(-4))) {
      if (l.trim()) console.log('      ' + l.trim().slice(0, 150));
    }
  }
}
process.exit(rotas.length ? 1 : 0);

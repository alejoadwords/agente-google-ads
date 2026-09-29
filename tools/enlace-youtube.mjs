#!/usr/bin/env node
// tools/enlace-youtube.mjs — el enlace para autorizar YouTube (Academia).
//
//   node tools/enlace-youtube.mjs <userId de Clerk>
//
// /api/yt-auth ya no acepta un ?userId= suelto: con él cualquiera podía colgarle
// su canal a una cuenta ajena. El enlace va firmado con LINK_SECRET, la clave
// del servidor, que se lee de Vercel igual que en tools/pruebas.mjs. Dura media
// hora: se saca, se abre y se autoriza.

import { execSync } from 'node:child_process';

const userId = process.argv[2];
if (!userId) {
  console.error('\n  Uso: node tools/enlace-youtube.mjs <userId de Clerk>\n');
  process.exit(2);
}

function tokenVercel() {
  if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN;
  try {
    return execSync('security find-generic-password -s "Vercel Acuarius" -a vercel -w',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    console.error('\n  Falta el token de Vercel (VERCEL_TOKEN o el llavero «Vercel Acuarius»).\n');
    process.exit(2);
  }
}

if (!process.env.LINK_SECRET) {
  const P = 'prj_jsnlNLBi8HKCxtA56xhyc65SuVIY', T = 'team_AMakmLzuhAWGyZv4OjCTtWJc';
  const cab = { Authorization: `Bearer ${tokenVercel()}` };
  const { envs } = await fetch(`https://api.vercel.com/v9/projects/${P}/env?teamId=${T}`, { headers: cab }).then(r => r.json());
  // La de PRODUCCIÓN: es la que va a comprobar la firma.
  const e = envs.find(x => x.key === 'LINK_SECRET' && (x.target || []).includes('production'));
  if (!e) { console.error('\n  No aparece LINK_SECRET de producción en Vercel.\n'); process.exit(1); }
  const v = await fetch(`https://api.vercel.com/v1/projects/${P}/env/${e.id}?teamId=${T}`, { headers: cab }).then(r => r.json());
  process.env.LINK_SECRET = v.value;
}

const { crearEnlaceCuenta, MINUTOS_ENLACE_CUENTA } = await import('../api/_enlace-calendario.js');
const t = await crearEnlaceCuenta(userId, 'youtube');
console.log('\n  https://app.acuarius.app/api/yt-auth?c=' + t + '\n\n  Vale ' + MINUTOS_ENLACE_CUENTA + ' minutos.\n');

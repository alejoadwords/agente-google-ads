// SQL directo contra la base de Acuarius, por la Management API de Supabase.
//
//   node --dns-result-order=ipv4first tools/sql.mjs "select ..."
//
// Usa el token del CLI de Supabase que está en el llavero (ver memoria
// reference_supabase_admin). Sirve para leer y para DDL. Ojo: también escribe
// —lo que se le pase se ejecuta— así que en datos de clientes, solo lectura
// salvo que se haya decidido con Alejandro (manual /soporte).

import { execSync } from 'child_process';

const PROYECTO = 'qgznzzhkuwxcknmcnrzn';
const query = process.argv[2];
if (!query) { console.error('Uso: node tools/sql.mjs "<consulta>"'); process.exit(2); }

const TOK = Buffer.from(
  execSync('security find-generic-password -s "Supabase CLI" -w').toString().trim().replace(/^go-keyring-base64:/, ''),
  'base64').toString();

for (let intento = 1; intento <= 3; intento++) {
  try {
    const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json', 'User-Agent': 'SupabaseCLI/2.72.7' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(30000),
    });
    const t = await r.text();
    if (!r.ok) { console.error('Error ' + r.status + ': ' + t); process.exit(1); }
    console.log(t);
    break;
  } catch (e) {
    if (intento === 3) { console.error(e.message); process.exit(1); }
  }
}

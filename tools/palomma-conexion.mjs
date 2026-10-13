// Crea (o rota) la conexión de Palomma de una cuenta.
//
//   node tools/palomma-conexion.mjs crear <user_id> [client_id]
//   node tools/palomma-conexion.mjs rotar <user_id>
//   node tools/palomma-conexion.mjs ver   <user_id>
//
// El secreto NUNCA sale por pantalla: se escribe en un fichero del Escritorio
// con permisos 600, junto a la URL, para entregárselo a Palomma por un canal
// seguro y borrarlo después. En la base solo queda su SHA-256. Al rotar, el
// secreto anterior se sigue aceptando hasta que se borre a mano
// (secreto_hash_anterior = null) cuando Palomma confirme el cambio.
//
// La base se toca por la Management API de Supabase con el token del CLI que
// está en el llavero (ver memoria reference_supabase_admin).

import { execSync } from 'child_process';
import { writeFileSync, chmodSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { randomBytes, createHash } from 'crypto';

const PROYECTO = 'qgznzzhkuwxcknmcnrzn';
const URL_BASE = 'https://app.acuarius.app/api/palomma';

const TOK = Buffer.from(
  execSync('security find-generic-password -s "Supabase CLI" -w').toString().trim().replace(/^go-keyring-base64:/, ''),
  'base64').toString();

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json', 'User-Agent': 'SupabaseCLI/2.72.7' },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error('SQL ' + r.status + ': ' + t.slice(0, 300));
  return JSON.parse(t);
}
const lit = v => v == null ? 'null' : "'" + String(v).replace(/'/g, "''") + "'";

function guardarSecreto(nombre, url, secreto) {
  const ruta = join(homedir(), 'Desktop', nombre);
  writeFileSync(ruta,
    'Webhooks de Palomma → Acuarius\n\n' +
    'URL del endpoint:\n' + url + '\n\n' +
    'Secreto compartido (header X-Palomma-Secret):\n' + secreto + '\n\n' +
    'Entregarlo a Palomma por un canal seguro y BORRAR este fichero después.\n');
  chmodSync(ruta, 0o600);
  return ruta;
}

const [accion, userId, clientId] = process.argv.slice(2);
if (!['crear', 'rotar', 'ver'].includes(accion) || !/^user_[A-Za-z0-9]+$/.test(userId || '')) {
  console.error('Uso: node tools/palomma-conexion.mjs crear|rotar|ver <user_id> [client_id]');
  process.exit(2);
}

const existentes = await sql(`select id, token, client_id, activo, eventos, ultimo_evento_at, secreto_hash_anterior is not null as rotando from palomma_conexiones where user_id = ${lit(userId)}`);

if (accion === 'ver') {
  console.log(existentes.length ? existentes.map(c => ({ ...c, url: URL_BASE + '?c=' + c.token })) : 'Sin conexión de Palomma para ' + userId);
  process.exit(0);
}

const secreto = randomBytes(32).toString('base64url');           // 43 caracteres
const hash = createHash('sha256').update(secreto).digest('hex');

if (accion === 'crear') {
  if (existentes.length) { console.error('Ya existe una conexión para esta cuenta; usa «rotar».'); process.exit(1); }
  const token = randomBytes(24).toString('hex');                  // 48 hex
  await sql(`insert into palomma_conexiones (user_id, client_id, token, secreto_hash, notas)
             values (${lit(userId)}, ${lit(clientId || null)}, ${lit(token)}, ${lit(hash)}, 'Creada con tools/palomma-conexion.mjs')`);
  const url = URL_BASE + '?c=' + token;
  const ruta = guardarSecreto('palomma-acuarius-' + userId.slice(-6) + '.txt', url, secreto);
  console.log('Conexión creada.\nURL: ' + url + '\nSecreto y URL guardados en: ' + ruta + ' (permisos 600). No se muestra aquí.');
} else {
  if (!existentes.length) { console.error('No hay conexión que rotar; usa «crear».'); process.exit(1); }
  const c = existentes[0];
  await sql(`update palomma_conexiones set secreto_hash_anterior = secreto_hash, secreto_hash = ${lit(hash)} where id = ${lit(c.id)}`);
  const ruta = guardarSecreto('palomma-acuarius-' + userId.slice(-6) + '-nuevo.txt', URL_BASE + '?c=' + c.token, secreto);
  console.log('Secreto rotado. El anterior se sigue aceptando hasta que pongas secreto_hash_anterior = null.\nNuevo secreto en: ' + ruta);
}

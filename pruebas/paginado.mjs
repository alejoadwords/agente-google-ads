// Prueba del lector paginado: node pruebas/paginado.mjs
//
// Dos mitades. Arriba se ejercita traerTodo() contra un servidor falso que
// imita el corte de PostgREST en 1.000 filas. Abajo se lee el código fuente de
// verdad para confirmar que los sitios que se cortaban ya no se cortan: una
// prueba que solo mira el módulo pasaría aunque nadie lo hubiera enchufado.

import { readFileSync } from 'node:fs';
import { traerTodo, PAGINA } from '../api/_paginado.js';

let fallos = 0;
const chk = (nombre, ok) => {
  console.log(`  ${ok ? '✓' : '✗'} ${nombre}`);
  if (!ok) fallos++;
};

// Servidor falso: guarda las URL que le piden y responde como PostgREST, que
// nunca devuelve más de PAGINA filas aunque le pidas más.
function servidor(total) {
  const vistas = [];
  globalThis.fetch = async (url) => {
    vistas.push(String(url));
    const u = new URL(String(url));
    const limit = Math.min(Number(u.searchParams.get('limit')) || PAGINA, PAGINA);
    const offset = Number(u.searchParams.get('offset')) || 0;
    const n = Math.max(0, Math.min(limit, total - offset));
    return { ok: true, json: async () => Array.from({ length: n }, (_, i) => ({ id: offset + i })) };
  };
  return vistas;
}

console.log('\nEl lector paginado\n');

{
  servidor(250);
  const r = await traerTodo('https://x/rest/v1/leads?select=id', {});
  chk('trae una colección más chica que una página', r.filas.length === 250 && !r.truncado);
}

{
  const vistas = servidor(1000);
  const r = await traerTodo('https://x/rest/v1/leads?select=id', {});
  chk('mil exactas: pide una segunda página para saber que no hay más',
      r.filas.length === 1000 && !r.truncado && vistas.length === 2);
}

{
  const vistas = servidor(4300);
  const r = await traerTodo('https://x/rest/v1/leads?select=id', {});
  chk('4.300 filas — lo que antes se cortaba en 1.000',
      r.filas.length === 4300 && !r.truncado && vistas.length === 5);
  chk('sin ids repetidos ni saltados', new Set(r.filas.map(f => f.id)).size === 4300);
}

{
  servidor(999999);
  const r = await traerTodo('https://x/rest/v1/leads?select=id', {}, { techo: 3000 });
  chk('al llegar al techo lo DICE en vez de callarse', r.filas.length === 3000 && r.truncado === true);
}

{
  const vistas = servidor(50);
  await traerTodo('https://x/rest/v1/leads?select=id&limit=10000', {});
  chk('quita el limit que traía la consulta original',
      !/limit=10000/.test(vistas[0]) && /limit=1000\b/.test(vistas[0]));
}

{
  const vistas = servidor(50);
  await traerTodo('https://x/rest/v1/leads?select=id', {});
  chk('sin orden propio, ordena por id para que el offset sea estable',
      /order=id\.asc/.test(vistas[0]));
}

{
  const vistas = servidor(50);
  await traerTodo('https://x/rest/v1/leads?select=id&order=stage_position.asc,created_at.desc', {});
  const orden = decodeURIComponent(new URL(vistas[0]).searchParams.get('order'));
  chk('a un orden ambiguo le añade el id como desempate',
      orden === 'stage_position.asc,created_at.desc,id.asc');
}

{
  const vistas = servidor(50);
  await traerTodo('https://x/rest/v1/leads?select=id&order=id.desc', {});
  chk('si ya ordena por id, no lo toca',
      decodeURIComponent(new URL(vistas[0]).searchParams.get('order')) === 'id.desc');
}

{
  globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => 'boom' });
  let grito = false;
  try { await traerTodo('https://x/rest/v1/leads?select=id', {}); } catch { grito = true; }
  chk('un error de la base sube, no devuelve media lista', grito);
}

console.log('\nY que esté realmente enchufado\n');

const campanas = readFileSync(new URL('../api/campaigns.js', import.meta.url), 'utf8');
const leads = readFileSync(new URL('../api/leads.js', import.meta.url), 'utf8');

chk('campaigns.js importa el lector', /import \{ traerTodo \} from '\.\/_paginado\.js'/.test(campanas));
chk('leads.js importa el lector', /import \{ traerTodo \} from '\.\/_paginado\.js'/.test(leads));

chk('ya no quedan limit=10000 fingidos en campaigns.js', !/limit=10000/.test(campanas));
chk('la lista de rebotes se pagina', !/select=to_email&limit=20000/.test(campanas));

// Positiva a propósito: un `!regex` sobre código que cambió de forma pasa en
// vacío y no avisa de nada. Aquí se exige ver la llamada, no su ausencia.
chk('el tablero lee con traerTodo y su techo',
    /const \{ filas, truncado \} = await traerTodo\(query, sbHeaders\(\), \{ techo: TECHO_TABLERO \}\)/.test(leads));
chk('el tablero devuelve la marca de truncado', /truncado, techo: TECHO_TABLERO/.test(leads));
chk('el techo del tablero está definido', /const TECHO_TABLERO = \d+/.test(leads));

chk('encolar una campaña truncada se rechaza',
    /if \(truncado\)[\s\S]{0,400}?audiencia_truncada: true/.test(campanas));
chk('la vista previa devuelve la marca', /truncado: resuelta\.truncado/.test(campanas));

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);

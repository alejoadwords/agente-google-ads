// Prueba del mantenimiento diario: node pruebas/retencion.mjs
//
// Lo que se vigila aquí no es la velocidad sino el daño: es el único borrado
// irreversible del sistema. Se comprueba que las URL no se pasan de largo, que
// no se borra el historial de un contacto que al final no se borra, y que
// ningún fallo se queda sin contar.

process.env.SUPABASE_URL = 'https://falso.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'clave-falsa';
process.env.CRON_SECRET = 'secreto';

import { readFileSync } from 'node:fs';

let fallos = 0;
const chk = (nombre, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${nombre}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

const TOPE_POSTGREST = 1000;
const LIMITE_URL = 8000; // lo que aguanta un servidor normal antes de un 414

function montar({ archivables = 0, purgables = 0, rompe = null } = {}) {
  const leads = {};
  for (let i = 0; i < archivables; i++) {
    leads[`a-${i}`] = { id: `a-${i}`, deleted_at: null, stage: 'perdido', updated_at: '2020-01-01T00:00:00Z' };
  }
  for (let i = 0; i < purgables; i++) {
    leads[`p-${i}`] = { id: `p-${i}`, deleted_at: '2020-01-01T00:00:00Z', stage: 'perdido', updated_at: '2020-01-01T00:00:00Z' };
  }
  const estado = {
    urlMasLarga: 0, lecturas: 0, borradosDependientes: {}, leadsBorrados: [],
    erroresRegistrados: [], vueltas: 0,
  };

  globalThis.fetch = async (url, op = {}) => {
    const u = String(url);
    const met = op.method || 'GET';
    estado.urlMasLarga = Math.max(estado.urlMasLarga, u.length);
    const ok = (d) => ({ ok: true, status: 200, text: async () => JSON.stringify(d), json: async () => d });

    if (u.includes('rpc/registrar_error')) {
      estado.erroresRegistrados.push(op.body ? JSON.parse(op.body) : {});
      return ok([]);
    }
    if (u.includes('/user_profiles')) {
      return ok([{ user_id: 'user-1', profile_data: { perdidos_dias: 180 } }]);
    }
    if (u.includes('/leads?') && met === 'GET') {
      estado.lecturas++;
      estado.vueltas++;
      if (estado.vueltas > 60) throw new Error('bucle infinito: sigue leyendo sin avanzar');
      const esPurga = u.includes('deleted_at=lt.');
      const filas = Object.values(leads).filter(l => esPurga ? l.deleted_at : !l.deleted_at);
      return ok(filas.slice(0, TOPE_POSTGREST).map(l => ({ id: l.id })));
    }
    if (u.includes('/leads?') && met === 'PATCH') {
      const ids = decodeURIComponent(u).match(/id=in\.\(([^)]*)\)/)?.[1].split(',') || [];
      for (const id of ids) if (leads[id]) leads[id].deleted_at = new Date().toISOString();
      return ok([]);
    }
    if (u.includes('/leads?') && met === 'DELETE') {
      const ids = decodeURIComponent(u).match(/id=in\.\(([^)]*)\)/)?.[1].split(',') || [];
      estado.leadsBorrados.push(...ids);
      for (const id of ids) delete leads[id];
      return ok([]);
    }
    // Tablas que cuelgan del lead
    const tabla = u.match(/rest\/v1\/([a-z_]+)\?/)?.[1];
    if (tabla && (met === 'DELETE' || met === 'PATCH')) {
      if (rompe === tabla) return { ok: false, status: 409, text: async () => 'clave foranea', json: async () => ({}) };
      estado.borradosDependientes[tabla] = (estado.borradosDependientes[tabla] || 0) + 1;
      return ok([]);
    }
    return ok([]);
  };
  return { leads, estado };
}

const peticion = { headers: { authorization: 'Bearer secreto' } };
const respuesta = () => { const r = {}; r.status = () => r; r.json = (d) => { r.cuerpo = d; return r; }; return r; };

const { default: cron } = await import('../api/cron-retention.js');

console.log('\n2.500 contactos que archivar y 1.500 que purgar\n');
{
  const m = montar({ archivables: 2500, purgables: 1500 });
  const res = respuesta();
  await cron(peticion, res);

  chk('archiva los 2.500, no 1.000', res.cuerpo.a_papelera === 2500, `fueron ${res.cuerpo.a_papelera}`);
  chk('purga los 1.500 más los recién archivados que ya vencieron',
      res.cuerpo.purgados >= 1500, `fueron ${res.cuerpo.purgados}`);
  chk('ninguna URL se pasa de largo (el fallo real: 1.000 ids = 37 KB)',
      m.estado.urlMasLarga < LIMITE_URL, `la más larga: ${m.estado.urlMasLarga}`);
  chk('sin errores', (res.cuerpo.errores || []).length === 0, JSON.stringify(res.cuerpo.errores));
  chk('no se quedó dando vueltas', m.estado.vueltas < 60, `vueltas=${m.estado.vueltas}`);
}

console.log('\nSi falla el borrado de una tabla dependiente\n');
{
  const m = montar({ purgables: 300, rompe: 'email_events' });
  const res = respuesta();
  await cron(peticion, res);

  chk('NO se borra ningún contacto', m.estado.leadsBorrados.length === 0,
      `se borraron ${m.estado.leadsBorrados.length}`);
  chk('los contactos siguen ahí', Object.keys(m.leads).length === 300);
  chk('el fallo queda registrado, no se traga', m.estado.erroresRegistrados.length > 0);
  chk('el registro dice dónde fue',
      JSON.stringify(m.estado.erroresRegistrados).includes('cron-retention/purga/dependientes'));
  chk('y usa un origen que el panel de errores agrupa',
      m.estado.erroresRegistrados.every(e => e.p_origen === 'cron'),
      JSON.stringify(m.estado.erroresRegistrados.map(e => e.p_origen)));
  chk('y no se queda reintentando en bucle', m.estado.vueltas < 60, `vueltas=${m.estado.vueltas}`);
}

console.log('\nCuando no hay nada que hacer\n');
{
  const m = montar({});
  const res = respuesta();
  await cron(peticion, res);
  chk('no archiva ni purga nada', res.cuerpo.a_papelera === 0 && res.cuerpo.purgados === 0);
  chk('no registra errores falsos', m.estado.erroresRegistrados.length === 0);
}

console.log('\nSin el secreto\n');
{
  montar({});
  const res = respuesta();
  let codigo = null;
  res.status = (c) => { codigo = c; return res; };
  await cron({ headers: {} }, res);
  chk('rechaza la petición', codigo === 401);
}

console.log('\nY lo que dice el código fuente\n');
{
  const src = readFileSync(new URL('../api/cron-retention.js', import.meta.url), 'utf8');
  chk('ya no queda el limit=2000 que devolvía 1.000', !/select=id&limit=2000/.test(src));
  chk('las escrituras van por tandas de ids', /const LOTE_IDS\s*=\s*100/.test(src));
  chk('los fallos se registran', /registrarError/.test(src));
  chk('no queda ningún borrado que se trague el error',
      !/method: 'DELETE', headers: sb\(\),?\s*\}\)\.catch/.test(src));
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);

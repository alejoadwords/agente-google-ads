// api/pipelines.js
// Varios pipelines por cuenta. Cada uno con sus propias etapas, incluidas las
// claves protegidas 'nuevo'/'ganado'/'perdido' — asi los modulos que comparan
// contra esas claves (automatizaciones, propuestas, MercadoPago, campanas,
// listas y la entrada de leads) siguen funcionando sin cambios.
//
// El codigo tolera que la migracion SQL no se haya corrido todavia: si la tabla
// 'pipelines' no existe, se devuelve un pipeline virtual y la app se comporta
// como antes. Asi el orden de despliegue no puede romper el CRM.
export const config = { runtime: 'edge' };

import { verificarSesion, cuerpoSinSesion } from './_sesion.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const MAX_PIPELINES = 10;   // mismo tope para todos los planes

const ETAPAS_POR_DEFECTO = [
  { key: 'nuevo',       label: 'Nuevo',        color: '#6B7280', position: 1 },
  { key: 'contactado',  label: 'Contactado',   color: '#3B82F6', position: 2 },
  { key: 'calificado',  label: 'Calificado',   color: '#8B5CF6', position: 3 },
  { key: 'propuesta',   label: 'Propuesta',    color: '#F59E0B', position: 4 },
  { key: 'negociacion', label: 'Negociación',  color: '#EF4444', position: 5 },
  { key: 'ganado',      label: 'Ganado',       color: '#10B981', position: 6 },
  { key: 'perdido',     label: 'Perdido',      color: '#9CA3AF', position: 7 },
];

function sbHeaders(prefer) {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': prefer || 'return=representation',
  };
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// Devuelve null si la tabla todavia no existe (migracion pendiente)
async function sb(path, method = 'GET', body = null, prefer) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method, headers: sbHeaders(prefer), body: body ? JSON.stringify(body) : null,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    // 42P01 = relacion inexistente. Es la senal de que falta la migracion.
    if (res.status === 404 || txt.includes('42P01') || txt.includes('does not exist')) return { falta: true };
    // El detalle de Postgres (constraint, columna, tipo) es justo lo que hace
    // falta para diagnosticar: se conserva en vez de perderlo en un 500 opaco.
    let detalle = txt;
    try {
      const j = JSON.parse(txt);
      detalle = [j.message, j.details, j.hint].filter(Boolean).join(' — ') || txt;
      if (j.code) detalle = '[' + j.code + '] ' + detalle;
    } catch {}
    const err = new Error(detalle || ('HTTP ' + res.status));
    err.supabase = true;
    err.ruta = path.split('?')[0];
    throw err;
  }
  const txt = await res.text();
  return { data: txt ? JSON.parse(txt) : null };
}

function ambito(clientId) {
  return clientId ? `&client_id=eq.${encodeURIComponent(clientId)}` : '&client_id=is.null';
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  try {
    return await manejar(req);
  } catch (e) {
    // Sin esto, cualquier error de la base salia como un 500 sin cuerpo y el
    // frontend solo podia decir "no se pudo": imposible de diagnosticar.
    return jsonResp({
      error: 'Error en la base de datos: ' + (e?.message || 'desconocido'),
      ruta: e?.ruta || null,
    }, 500);
  }
}

async function manejar(req) {

  const sesion = await verificarSesion(req);
  let userId = sesion.id;
  if (!userId) return jsonResp(await cuerpoSinSesion(sesion, 'pipelines'), 401);

  // Equipo: si soy miembro activo de un workspace, opero sobre los datos del
  // dueño. /api/leads ya lo hacía; sin esto aquí, un miembro veía sus propios
  // pipelines mientras los leads venían del dueño, así que ningún pipeline
  // mostraba un solo lead y cambiar de uno a otro no hacía nada visible.
  // Si esta consulta falla NO se puede seguir: sin ella un miembro operaria
  // sobre su propia cuenta en vez de la del dueño, y devolveriamos datos de
  // otra cuenta como si fueran los suyos. Mejor un error que el tablero de
  // otro. (Un array vacio si es valido: significa que no es miembro.)
  // A que cliente esta acotado este miembro. Se lee en la MISMA consulta que
  // ya resolvia al dueno: sin esto habria que preguntarlo otra vez.
  let clienteDelMiembro = null;
  try {
    const _twRes = await fetch(`${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id,client_id&limit=1`, { headers: sbHeaders() });
    if (!_twRes.ok) throw new Error('HTTP ' + _twRes.status);
    const _tw = (await _twRes.json())?.[0];
    if (_tw && _tw.owner_user_id) { userId = _tw.owner_user_id; clienteDelMiembro = _tw.client_id || null; }
  } catch (e) {
    return jsonResp({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503);
  }

  const url = new URL(req.url);
  const clientId = clienteDelMiembro || url.searchParams.get('client_id') || null;

  // ── Listar ────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const r = await sb(`/pipelines?user_id=eq.${userId}${ambito(clientId)}&select=*&order=position.asc`);
    if (r.falta) return jsonResp({ pipelines: [], migracion_pendiente: true });

    let filas = r.data || [];
    if (!filas.length) {
      // Primer uso en este ambito: crear el principal con las etapas por defecto
      const creado = await crearPipeline(userId, clientId, 'Principal', true, 1);
      if (creado.falta) return jsonResp({ pipelines: [], migracion_pendiente: true });
      filas = creado.pipeline ? [creado.pipeline] : [];
    }
    return jsonResp({ pipelines: filas, max: MAX_PIPELINES });
  }

  // ── Crear ─────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const nombre = String(body.name || '').trim().slice(0, 60);
    if (!nombre) return jsonResp({ error: 'Ponle un nombre al pipeline' }, 400);

    const r = await sb(`/pipelines?user_id=eq.${userId}${ambito(clientId)}&select=id,position`);
    if (r.falta) return jsonResp({ error: 'Falta correr la migración de pipelines en la base de datos', migracion_pendiente: true }, 409);

    const actuales = r.data || [];
    if (actuales.length >= MAX_PIPELINES) {
      return jsonResp({ error: `Llegaste al máximo de ${MAX_PIPELINES} pipelines. Borra alguno para crear otro.`, limite: true }, 403);
    }
    const pos = actuales.reduce((m, p) => Math.max(m, p.position || 0), 0) + 1;
    const creado = await crearPipeline(userId, clientId, nombre, actuales.length === 0, pos);
    if (creado.error) return jsonResp({ error: creado.error }, 500);
    return jsonResp({ pipeline: creado.pipeline });
  }

  // ── Renombrar / marcar principal ──────────────────────────────────────────
  if (req.method === 'PUT') {
    const body = await req.json().catch(() => ({}));
    const id = body.id;
    if (!id) return jsonResp({ error: 'Falta el id del pipeline' }, 400);

    const mio = await sb(`/pipelines?id=eq.${id}&user_id=eq.${userId}&select=*`);
    if (mio.falta || !mio.data?.length) return jsonResp({ error: 'Pipeline no encontrado' }, 404);
    const actual = mio.data[0];

    if (body.is_default === true) {
      // Solo puede haber un principal por ambito
      await sb(`/pipelines?user_id=eq.${userId}${ambito(actual.client_id)}`, 'PATCH', { is_default: false }, 'return=minimal');
    }
    const cambios = {};
    if (body.name !== undefined) {
      const n = String(body.name).trim().slice(0, 60);
      if (!n) return jsonResp({ error: 'El nombre no puede quedar vacío' }, 400);
      cambios.name = n;
    }
    if (body.is_default !== undefined) cambios.is_default = !!body.is_default;
    if (body.position !== undefined) cambios.position = parseInt(body.position, 10) || 1;
    if (!Object.keys(cambios).length) return jsonResp({ error: 'Nada que cambiar' }, 400);

    const upd = await sb(`/pipelines?id=eq.${id}&user_id=eq.${userId}`, 'PATCH', cambios);
    return jsonResp({ pipeline: upd.data?.[0] || null });
  }

  // ── Borrar ────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return jsonResp({ error: 'Falta el id del pipeline' }, 400);

    const mio = await sb(`/pipelines?id=eq.${id}&user_id=eq.${userId}&select=*`);
    if (mio.falta || !mio.data?.length) return jsonResp({ error: 'Pipeline no encontrado' }, 404);
    const actual = mio.data[0];

    const hermanos = await sb(`/pipelines?user_id=eq.${userId}${ambito(actual.client_id)}&select=id,is_default,position&order=position.asc`);
    const otros = (hermanos.data || []).filter(p => p.id !== id);
    if (!otros.length) return jsonResp({ error: 'Es tu único pipeline: no se puede borrar.' }, 400);

    // Los leads no se pierden: pasan al principal (o al primero que quede).
    const destino = otros.find(p => p.is_default) || otros[0];
    const clavesDestino = await sb(`/pipeline_stages?pipeline_id=eq.${destino.id}&select=key`);
    const validas = new Set((clavesDestino.data || []).map(s => s.key));

    // Se mueven con dos PATCH filtrados en la base, sin leerlos antes: leerlos
    // topaba en mil filas, y de un pipeline con más se movían mil y el resto
    // quedaba colgando de un pipeline borrado, invisible en todas partes.
    // Si el destino no tiene esa etapa, el lead cae en 'nuevo' para que nunca
    // quede en una etapa fantasma que no se pinta en ninguna columna.
    const ahora = new Date().toISOString();
    const base = `/leads?pipeline_id=eq.${id}&user_id=eq.${userId}`;
    const lista = [...validas].map(k => `"${String(k).replace(/"/g, '')}"`).join(',');
    const conEtapa = validas.size
      ? await sb(`${base}&stage=in.(${encodeURIComponent(lista)})&select=id`, 'PATCH', { pipeline_id: destino.id, updated_at: ahora }, 'return=representation')
      : { data: [] };
    const resto = await sb(`${base}&select=id`, 'PATCH', { pipeline_id: destino.id, stage: 'nuevo', updated_at: ahora }, 'return=representation');
    const aMover = [...(conEtapa.data || []), ...(resto.data || [])];

    await sb(`/pipeline_stages?pipeline_id=eq.${id}`, 'DELETE', null, 'return=minimal');
    await sb(`/pipelines?id=eq.${id}&user_id=eq.${userId}`, 'DELETE', null, 'return=minimal');

    if (actual.is_default) {
      await sb(`/pipelines?id=eq.${destino.id}`, 'PATCH', { is_default: true }, 'return=minimal');
    }
    return jsonResp({ ok: true, leads_movidos: aMover.length, destino: destino.id });
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}

async function crearPipeline(userId, clientId, nombre, esPrincipal, position) {
  const r = await sb('/pipelines', 'POST', {
    user_id: userId, client_id: clientId, name: nombre, is_default: !!esPrincipal, position,
  });
  if (r.falta) return { falta: true };
  const pipeline = r.data?.[0];
  if (!pipeline) return { error: 'No se pudo crear el pipeline' };

  // Etapas propias, con las tres claves protegidas incluidas
  const etapas = ETAPAS_POR_DEFECTO.map(e => ({
    user_id: userId, pipeline_id: pipeline.id,
    key: e.key, label: e.label, color: e.color, position: e.position,
  }));
  try {
    await sb('/pipeline_stages', 'POST', etapas, 'return=minimal,resolution=ignore-duplicates');
  } catch (e) {
    // Un pipeline sin etapas no se puede usar: se deshace para no dejar basura.
    await sb(`/pipelines?id=eq.${pipeline.id}`, 'DELETE', null, 'return=minimal').catch(() => {});
    const msg = String(e?.message || '');
    // 23505 = clave duplicada. Casi seguro el indice unico antiguo
    // (user_id, key), que impide que dos pipelines tengan su propio 'nuevo'.
    if (msg.includes('23505')) {
      throw new Error('Falta soltar el índice único antiguo de pipeline_stages ' +
        '(user_id, key): impide que cada pipeline tenga sus propias etapas. Detalle: ' + msg);
    }
    throw e;
  }
  return { pipeline };
}

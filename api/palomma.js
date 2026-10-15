// api/palomma.js — receptor de los webhooks de Palomma.
//
//   POST https://app.acuarius.app/api/palomma?c=<token de la conexión>
//   Header X-Palomma-Secret: <secreto compartido>
//
// Paso 1 de la integración (13-10-2026): verifica el secreto, guarda el evento
// crudo en palomma_eventos y responde. NO toca leads todavía. Palomma no
// reintenta, así que lo único que importa aquí es no perder un aviso: si la
// base falla se responde 503 (queda en su registro de fallos) y se registra el
// error para que lo veamos nosotros. La conexión se crea con
// tools/palomma-conexion.mjs.

import { secretoValido, filaDeEvento } from './_palomma.js';
import { registrarError } from './_registro-errores.js';
import { procesarPendientes } from './_palomma-proceso.js';

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = (extra = {}) => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', ...extra });

// lead.status-updated trae la transcripción completa de WhatsApp; Palomma
// sugiere aceptar al menos 2 MB.
const MAX_BYTES = 4 * 1024 * 1024;

const resp = (status, cuerpo) => new Response(cuerpo ? JSON.stringify(cuerpo) : null, {
  status, headers: { 'Content-Type': 'application/json' },
});

export default async function handler(req, contexto) {
  if (req.method !== 'POST') return resp(405, { error: 'Solo POST' });

  const token = new URL(req.url).searchParams.get('c') || '';
  if (!/^[a-f0-9]{32,64}$/.test(token)) return resp(404, { error: 'Conexión desconocida' });

  let conexion;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/palomma_conexiones?token=eq.${token}&select=id,user_id,secreto_hash,secreto_hash_anterior,activo,eventos&limit=1`, { headers: sbH() });
    if (!r.ok) throw new Error('Supabase ' + r.status);
    conexion = (await r.json())?.[0];
  } catch (e) {
    await registrarError({ origen: 'servidor', donde: 'palomma.conexion', error: e });
    return resp(503, { error: 'No disponible, reintenta' });
  }
  if (!conexion || !conexion.activo) return resp(404, { error: 'Conexión desconocida' });

  if (!(await secretoValido(req.headers.get('x-palomma-secret'), conexion))) {
    await registrarError({ origen: 'servidor', donde: 'palomma.secreto', error: new Error('Secreto de Palomma inválido'), usuario: conexion.user_id });
    return resp(401, { error: 'Secreto inválido' });
  }

  const texto = await req.text();
  if (texto.length > MAX_BYTES) {
    await registrarError({ origen: 'servidor', donde: 'palomma.tamano', error: new Error('Evento de Palomma demasiado grande: ' + texto.length + ' bytes'), usuario: conexion.user_id });
    return resp(413, { error: 'Evento demasiado grande' });
  }
  let evento;
  try { evento = JSON.parse(texto); } catch { evento = null; }
  const { fila, error } = filaDeEvento(evento, conexion);
  if (error) {
    await registrarError({ origen: 'servidor', donde: 'palomma.formato', error: new Error('Evento de Palomma no válido: ' + error), usuario: conexion.user_id, detalle: texto.slice(0, 500) });
    return resp(400, { error });
  }

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/palomma_eventos?on_conflict=conexion_id,tipo,palomma_lead_id,ts`, {
      method: 'POST',
      headers: sbH({ Prefer: 'resolution=ignore-duplicates,return=minimal' }),
      body: JSON.stringify(fila),
    });
    if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + (await r.text()).slice(0, 200));
  } catch (e) {
    await registrarError({ origen: 'servidor', donde: 'palomma.guardar', error: e, usuario: conexion.user_id, detalle: fila.tipo + ' ' + fila.palomma_lead_id });
    return resp(503, { error: 'No se pudo guardar, reintenta' });
  }

  // Contador y último aviso: para ver de un vistazo que la conexión está viva.
  // Si falla no importa: el evento ya está guardado.
  await fetch(`${SUPABASE_URL}/rest/v1/palomma_conexiones?id=eq.${conexion.id}`, {
    method: 'PATCH', headers: sbH({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ eventos: (conexion.eventos || 0) + 1, ultimo_evento_at: new Date().toISOString() }),
  }).catch(() => {});

  // Paso 2, en segundo plano: Palomma ya tiene su 200 y no espera. Lo que no
  // termine aquí lo recoge cron-palomma.
  if (contexto && typeof contexto.waitUntil === 'function') {
    contexto.waitUntil(procesarPendientes({ conexionId: conexion.id, limite: 20 }).catch(() => {}));
  }
  return resp(200, { ok: true });
}

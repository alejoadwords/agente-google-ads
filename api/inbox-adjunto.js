// api/inbox-adjunto.js
// Da permiso para subir un archivo del inbox y devuelve dónde dejarlo.
//
// El archivo NO pasa por aquí: el navegador lo sube directo a Supabase con una
// URL firmada. Una función de Vercel no admite cuerpos de más de ~4,5 MB, así
// que mandar los bytes por aquí habría dejado fuera cualquier PDF con fotos
// —justo lo que una inmobiliaria necesita enviar.
export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = 'inbox-adjuntos';

// Los topes son los de WhatsApp, no los nuestros: mandar de más sería subir el
// archivo entero para que Meta lo rechace al final.
const TOPES = { image: 5, video: 16, audio: 16, document: 16 };

// Lo que Meta acepta. Fuera de esta lista el archivo llegaría al bucket y se
// quedaría ahí sin poder enviarse.
const TIPOS = {
  'image/jpeg': ['image', 'jpg'], 'image/png': ['image', 'png'], 'image/webp': ['image', 'webp'],
  'application/pdf': ['document', 'pdf'],
  'application/msword': ['document', 'doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['document', 'docx'],
  'application/vnd.ms-excel': ['document', 'xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['document', 'xlsx'],
  'application/vnd.ms-powerpoint': ['document', 'ppt'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['document', 'pptx'],
  'text/plain': ['document', 'txt'],
  'text/csv': ['document', 'csv'],
  'video/mp4': ['video', 'mp4'],
  'audio/mpeg': ['audio', 'mp3'],
  'audio/ogg': ['audio', 'ogg'],
};

function sb() {
  return { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` };
}

async function getUserId(req) {
  const auth = req.headers.get('Authorization');
  if (!auth) return null;
  const token = auth.replace('Bearer ', '');
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [hB64, pB64, sB64] = parts;
    const header = JSON.parse(atob(hB64.replace(/-/g, '+').replace(/_/g, '/')));
    const jwks = await fetch('https://clerk.acuarius.app/.well-known/jwks.json').then(r => r.json());
    const key = jwks.keys?.find(k => k.kid === header.kid);
    if (!key) return null;
    const ck = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const sig = Uint8Array.from(atob(sB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const data = new TextEncoder().encode(`${hB64}.${pB64}`);
    if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', ck, sig, data)) return null;
    const payload = JSON.parse(atob(pB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub || null;
  } catch { return null; }
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// Un nombre corto y sin sorpresas. El nombre de verdad se guarda en el mensaje;
// este solo tiene que ser único y no poder salirse de su carpeta.
function nombreSeguro(ext) {
  const azar = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  return `${Date.now()}_${azar}.${ext}`;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return jsonResp({ error: 'Método no permitido' }, 405);

  let userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id&limit=1`, { headers: sb() });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const tw = (await r.json())?.[0];
    if (tw && tw.owner_user_id) userId = tw.owner_user_id;
  } catch {
    return jsonResp({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503);
  }

  const body = await req.json().catch(() => ({}));
  const mime = String(body.mime || '').toLowerCase();
  const tamano = Number(body.tamano || 0);
  const convId = body.conversation_id;
  const conexionId = body.connection_id;   // solo para el simulador

  if (!convId && !conexionId) return jsonResp({ error: 'Falta la conversación' }, 400);
  const par = TIPOS[mime];
  if (!par) return jsonResp({ error: 'WhatsApp no acepta ese tipo de archivo. Usa imagen (JPG, PNG, WebP), PDF, Word, Excel, PowerPoint, texto, MP4 o audio.' }, 400);
  const [tipo, ext] = par;
  if (!tamano) return jsonResp({ error: 'El archivo está vacío' }, 400);
  if (tamano > TOPES[tipo] * 1024 * 1024) {
    return jsonResp({ error: `WhatsApp no acepta ${tipo === 'image' ? 'imágenes' : 'archivos'} de más de ${TOPES[tipo]} MB.` }, 400);
  }

  // El destino tiene que ser de esta cuenta. Sin esto, cualquiera con sesión
  // podría dejar archivos colgando de la conversación de otro.
  let carpeta;
  if (convId) {
    const ck = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${encodeURIComponent(convId)}&user_id=eq.${encodeURIComponent(userId)}&select=id`,
      { headers: sb() }
    ).then(r => (r.ok ? r.json() : [])).catch(() => []);
    if (!ck?.[0]) return jsonResp({ error: 'No autorizado' }, 403);
    carpeta = convId;
  } else {
    // Simulador: la conversación puede no existir todavía. Se admite solo sobre
    // un canal de PRUEBA propio, nunca sobre uno real.
    const con = await fetch(
      `${SUPABASE_URL}/rest/v1/channel_connections?id=eq.${encodeURIComponent(conexionId)}&user_id=eq.${encodeURIComponent(userId)}&select=external_id`,
      { headers: sb() }
    ).then(r => (r.ok ? r.json() : [])).then(r => r?.[0]).catch(() => null);
    if (!con) return jsonResp({ error: 'No autorizado' }, 403);
    if (!String(con.external_id || '').startsWith('sim_')) {
      return jsonResp({ error: 'Solo se pueden simular adjuntos en un canal de prueba.' }, 400);
    }
    carpeta = 'simulados';
  }

  const ruta = `${userId}/${carpeta}/${nombreSeguro(ext)}`;
  const firma = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${ruta}`, {
    method: 'POST', headers: sb(), body: JSON.stringify({}),
  });
  if (!firma.ok) {
    const txt = (await firma.text()).slice(0, 200);
    // El fallo típico la primera vez: el bucket no existe todavía.
    if (/not found|bucket/i.test(txt)) {
      return jsonResp({ error: 'Falta crear el almacén de adjuntos en Supabase (bucket inbox-adjuntos).' }, 500);
    }
    return jsonResp({ error: 'No se pudo preparar la subida: ' + txt }, 500);
  }
  const datos = await firma.json().catch(() => ({}));
  if (!datos.url) return jsonResp({ error: 'No se pudo preparar la subida' }, 500);

  return jsonResp({
    subir_a: `${SUPABASE_URL}/storage/v1${datos.url}`,
    url: `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${ruta}`,
    tipo,
  });
}

// api/video-gen.js
// Genera videos publicitarios usando BytePlus ModelArk Seedance 2.0
// action=submit  → envía job, devuelve { job_id }
// action=status  → consulta estado, devuelve { status, video_url }
//
// Este endpoint no pedía credenciales de ninguna clase y es el más caro de la
// plataforma (~$0,45 por video). El descuento de créditos vivía en otro
// endpoint (api/video-credits.js) que el navegador llamaba por voluntad propia
// — y que además se creía el contenido del token sin verificar la firma. O sea
// que el cupo de videos no existía. Ahora la puerta está aquí, donde se gasta.
//
// La verificación va copiada y no importada de un módulo compartido: importar
// ESM desde una función Node rompe SU build en silencio (READY y ruta muerta).

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const COSTO_VIDEO = 0.45;
const CUPO_VIDEOS = { free: 1, trial: 5, individual: 5, pro: 5, agency: 15, agencia: 15 };

async function usuarioDelToken(req) {
  try {
    const auth = req.headers.authorization || req.headers.Authorization || '';
    const token = auth.replace('Bearer ', '').trim();
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [hB64, pB64, sB64] = parts;
    const b64 = x => Buffer.from(x.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const header = JSON.parse(b64(hB64).toString('utf8'));
    const jwks = await fetch('https://clerk.acuarius.app/.well-known/jwks.json').then(r => r.json());
    const key = jwks.keys?.find(k => k.kid === header.kid);
    if (!key) return null;
    const cryptoKey = await crypto.subtle.importKey(
      'jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', cryptoKey, b64(sB64), new TextEncoder().encode(`${hB64}.${pB64}`)
    );
    if (!valid) return null;
    const payload = JSON.parse(b64(pB64).toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub || null;
  } catch { return null; }
}

const sbCab = () => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` });

async function cuentaDe(actorId) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(actorId)}` +
      `&status=eq.active&select=owner_user_id&limit=1`, { headers: sbCab() });
    const tw = r.ok ? (await r.json())?.[0] : null;
    return tw?.owner_user_id || actorId;
  } catch { return actorId; }
}

async function planDe(userId) {
  try {
    const r = await fetch('https://api.clerk.com/v1/users/' + userId, {
      headers: { Authorization: 'Bearer ' + process.env.CLERK_SECRET_KEY },
    });
    const u = await r.json();
    return u?.public_metadata?.plan || 'free';
  } catch { return 'pro'; }
}

// Videos lanzados este mes. Se cuenta el ENVÍO, no la entrega: BytePlus cobra
// el trabajo aunque el usuario cierre la pestaña sin recoger el resultado.
async function videosDelMes(userId) {
  try {
    const d = new Date();
    const desde = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/ai_usage?user_id=eq.${encodeURIComponent(userId)}&origen=eq.video` +
      `&created_at=gte.${encodeURIComponent(desde)}&select=id&limit=1`,
      { headers: { ...sbCab(), Prefer: 'count=exact' } });
    if (!r.ok) return null;
    const total = parseInt((r.headers.get('content-range') || '').split('/')[1], 10);
    return Number.isFinite(total) ? total : null;
  } catch { return null; }
}

async function apuntarVideo(userId, actorId, detalle) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/ai_usage`, {
      method: 'POST',
      headers: { ...sbCab(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        user_id: userId, actor_id: actorId, origen: 'video',
        agente: detalle, modelo: detalle,
        tokens_in: 0, tokens_out: 0, cache_write: 0, cache_read: 0, costo: COSTO_VIDEO,
      }),
    });
  } catch (e) { console.error('apuntarVideo:', e?.message); }
}

const BASE = 'https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const BYTEPLUS_API_KEY = process.env.BYTEPLUS_API_KEY;
  if (!BYTEPLUS_API_KEY) return res.status(500).json({ error: 'BYTEPLUS_API_KEY no configurado en Vercel' });

  const { action, job_id, prompt, aspect_ratio, duration, resolution, reference_image } = req.body;

  try {
    // ── STATUS ────────────────────────────────────────────────────────────────
    if (action === 'status') {
      if (!job_id) return res.status(400).json({ error: 'job_id requerido' });

      const statusRes = await fetch(`${BASE}/${job_id}`, {
        headers: { 'Authorization': `Bearer ${BYTEPLUS_API_KEY}` }
      });

      const raw = await statusRes.text();
      let data;
      try { data = JSON.parse(raw); } catch {
        return res.status(500).json({ error: `HTTP ${statusRes.status} — no-JSON: "${raw.slice(0, 300)}"` });
      }
      if (!statusRes.ok) return res.status(statusRes.status).json({ error: data.error?.message || data.message || JSON.stringify(data).slice(0, 300) });

      const bpStatus = data.status || data.task_status || 'running';
      const isCompleted = bpStatus === 'succeeded' || bpStatus === 'completed';
      const isFailed = bpStatus === 'failed' || bpStatus === 'error';

      // Try every known structure BytePlus may return
      const contentArr = Array.isArray(data.content) ? data.content : [];
      const outputsArr = Array.isArray(data.outputs) ? data.outputs : [];
      const contentObj = (!Array.isArray(data.content) && data.content && typeof data.content === 'object') ? data.content : null;
      const resultsArr = Array.isArray(data.results) ? data.results : [];

      const videoUrl = contentArr.find(c => c.type === 'video')?.url
                    || contentArr.find(c => c.video_url)?.video_url
                    || contentArr[0]?.url
                    || outputsArr.find(o => o.type === 'video')?.url
                    || outputsArr[0]?.url
                    || resultsArr.find(r => r.type === 'video')?.url
                    || resultsArr[0]?.url
                    || contentObj?.url
                    || contentObj?.video_url
                    || data.video_url
                    || data.result?.url
                    || data.result?.video_url
                    || null;

      return res.json({
        status: isCompleted ? 'completed' : isFailed ? 'failed' : 'running',
        video_url: videoUrl,
        error: isFailed ? (data.error?.message || bpStatus) : null,
        // _debug solo en fallo para diagnóstico
        ...(isFailed || (isCompleted && !videoUrl) ? { _debug: JSON.stringify(data).slice(0, 1000) } : {})
      });
    }

    // ── SUBMIT ────────────────────────────────────────────────────────────────
    if (action === 'submit') {
      if (!prompt) return res.status(400).json({ error: 'prompt requerido' });

      // La puerta va solo en submit: consultar el estado no le cuesta nada a
      // nadie, y cortarlo dejaría videos ya pagados sin poder recogerse.
      const actorId = await usuarioDelToken(req);
      if (!actorId) return res.status(401).json({ error: 'No autorizado.' });
      const cuenta = await cuentaDe(actorId);
      const plan = await planDe(cuenta);
      const tope = CUPO_VIDEOS[plan] ?? CUPO_VIDEOS.free;
      const usados = await videosDelMes(cuenta);
      if (usados === null) {
        console.error('[video-gen] no se pudo leer el cupo de', cuenta, '— se deja pasar');
      } else if (usados >= tope) {
        return res.status(429).json({
          error: `Usaste tus ${tope} videos de este mes.`,
          upgrade: plan === 'free' || plan === 'pro',
          cupo: { plan, limite: tope, usados },
        });
      }

      const resolutionMap = {
        '16:9': '1920x1080',
        '1:1':  '1080x1080',
        '9:16': '1080x1920',
      };

      const content = [];
      if (reference_image) {
        content.push({ type: 'image_url', image_url: { url: reference_image } });
      }
      content.push({ type: 'text', text: prompt });

      const body = {
        model: 'dreamina-seedance-2-0-260128',
        content,
        ratio: aspect_ratio || '9:16',
        resolution: resolution || '1080p',
        duration: duration || 10,
        generate_audio: !!reference_image,
      };

      const submitRes = await fetch(BASE, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${BYTEPLUS_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      const raw = await submitRes.text();
      let data;
      try { data = JSON.parse(raw); } catch {
        return res.status(500).json({ error: `HTTP ${submitRes.status} — no-JSON: "${raw.slice(0, 300)}"` });
      }
      if (!submitRes.ok) return res.status(submitRes.status).json({ error: data.error?.message || data.message || JSON.stringify(data).slice(0, 300) });

      const jobId = data.id || data.task_id;
      if (!jobId) return res.status(500).json({ error: 'Sin job_id en respuesta: ' + JSON.stringify(data).slice(0, 300) });

      await apuntarVideo(cuenta, actorId, 'byteplus:seedance-2.0');
      return res.json({ job_id: jobId, _submit_debug: JSON.stringify(data).slice(0, 500) });
    }

    return res.status(400).json({ error: 'action inválida. Usa submit o status' });

  } catch (err) {
    return res.status(500).json({ error: 'Error interno: ' + err.message });
  }
}

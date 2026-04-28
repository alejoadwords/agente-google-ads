// api/video-gen.js
// Genera videos publicitarios usando BytePlus ModelArk Seedance 2.0
// action=submit  → envía job, devuelve { job_id }
// action=status  → consulta estado, devuelve { status, video_url }

const BASE = 'https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const BYTEPLUS_API_KEY = process.env.BYTEPLUS_API_KEY;
  if (!BYTEPLUS_API_KEY) return res.status(500).json({ error: 'BYTEPLUS_API_KEY no configurado en Vercel' });

  const { action, job_id, prompt, aspect_ratio, duration, resolution } = req.body;

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

      // La respuesta tiene status: "running" | "succeeded" | "failed"
      const videoUrl = data.content?.find(c => c.type === 'video')?.url
                    || data.outputs?.find(o => o.type === 'video')?.url
                    || null;
      return res.json({
        status: data.status === 'succeeded' ? 'completed' : data.status,
        video_url: videoUrl,
        error: data.error?.message || null
      });
    }

    // ── SUBMIT ────────────────────────────────────────────────────────────────
    if (action === 'submit') {
      if (!prompt) return res.status(400).json({ error: 'prompt requerido' });

      const resolutionMap = {
        '16:9': '1920x1080',
        '1:1':  '1080x1080',
        '9:16': '1080x1920',
      };

      const body = {
        model: 'dreamina-seedance-2-0-260128',
        content: [{ type: 'text', text: prompt }],
        ratio: aspect_ratio || '9:16',
        resolution: resolution || '1080p',
        duration: duration || 10,
        generate_audio: true,
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

      return res.json({ job_id: jobId });
    }

    return res.status(400).json({ error: 'action inválida. Usa submit o status' });

  } catch (err) {
    return res.status(500).json({ error: 'Error interno: ' + err.message });
  }
}

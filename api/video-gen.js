// api/video-gen.js
// Genera videos publicitarios usando BytePlus ModelArk Seedance 2.0
// action=submit  → envía job, devuelve { job_id }
// action=status  → consulta estado, devuelve { status, video_url }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const BYTEPLUS_API_KEY = process.env.BYTEPLUS_API_KEY;
  if (!BYTEPLUS_API_KEY) return res.status(500).json({ error: 'BYTEPLUS_API_KEY no configurado en Vercel' });

  const { action, job_id, prompt, aspect_ratio, duration, resolution, style } = req.body;

  try {
    // ── STATUS ────────────────────────────────────────────────────────────────
    if (action === 'status') {
      if (!job_id) return res.status(400).json({ error: 'job_id requerido' });

      const statusRes = await fetch(
        `https://ark.ap-southeast.bytepluses.com/api/v3/videos/generations/${job_id}`,
        { headers: { 'Authorization': `Bearer ${BYTEPLUS_API_KEY}` } }
      );

      const raw = await statusRes.text();
      let data;
      try { data = JSON.parse(raw); } catch {
        return res.status(500).json({ error: `HTTP ${statusRes.status} — respuesta no-JSON: "${raw.slice(0, 300)}"` });
      }

      if (!statusRes.ok) return res.status(statusRes.status).json({ error: data.error?.message || data.message || JSON.stringify(data).slice(0, 300) });

      const vid = data.output?.video_url || (data.videos && data.videos[0]?.url) || null;
      return res.json({ status: data.status || data.task_status || 'running', video_url: vid });
    }

    // ── SUBMIT ────────────────────────────────────────────────────────────────
    if (action === 'submit') {
      if (!prompt) return res.status(400).json({ error: 'prompt requerido' });

      const body = {
        model: 'seedance-1-0-pro-t2v-250428',
        content: [{ type: 'text', text: prompt }],
        parameters: {
          resolution: aspect_ratio === '16:9' ? '1920x1080'
                    : aspect_ratio === '1:1'  ? '1080x1080'
                    : '1080x1920',
          duration: duration || 10,
        }
      };

      const submitRes = await fetch(
        'https://ark.ap-southeast.bytepluses.com/api/v3/videos/generations',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${BYTEPLUS_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        }
      );

      const raw = await submitRes.text();
      let data;
      try { data = JSON.parse(raw); } catch {
        return res.status(500).json({ error: `HTTP ${submitRes.status} — respuesta no-JSON: "${raw.slice(0, 300)}"` });
      }

      if (!submitRes.ok) return res.status(submitRes.status).json({ error: data.error?.message || data.message || JSON.stringify(data).slice(0, 300) });

      const jobId = data.id || data.task_id || data.job_id;
      if (!jobId) return res.status(500).json({ error: 'BytePlus no devolvió job_id. Respuesta: ' + JSON.stringify(data).slice(0, 300) });

      return res.json({ job_id: jobId });
    }

    return res.status(400).json({ error: 'action inválida. Usa submit o status' });

  } catch (err) {
    return res.status(500).json({ error: 'Error interno (catch): ' + err.message + ' | stack: ' + (err.stack || '').slice(0, 200) });
  }
}

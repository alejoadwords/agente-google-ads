// api/video-gen.js
// Genera videos publicitarios usando BytePlus Seedance 2.0
// action=submit  → envía job a BytePlus, devuelve { job_id }
// action=status  → consulta estado del job, devuelve { status, video_url }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const BYTEPLUS_API_KEY = process.env.BYTEPLUS_API_KEY;
  if (!BYTEPLUS_API_KEY) return res.status(500).json({ error: 'BYTEPLUS_API_KEY no configurado' });

  const { action, job_id, prompt, aspect_ratio, duration, resolution, style, reference_image_url } = req.body;

  // ── STATUS: consultar estado de un job existente ──────────────────────────
  if (action === 'status') {
    if (!job_id) return res.status(400).json({ error: 'job_id requerido' });

    const statusRes = await fetch(`https://api.byteplus.com/seedance/v1/videos/${job_id}`, {
      headers: { 'Authorization': `Bearer ${BYTEPLUS_API_KEY}` }
    });

    if (!statusRes.ok) {
      const err = await statusRes.text();
      return res.status(statusRes.status).json({ error: err });
    }

    const data = await statusRes.json();
    return res.json({
      status: data.status,
      video_url: data.output?.video_url || null,
      error: data.error || null
    });
  }

  // ── SUBMIT: crear nuevo job de generación ─────────────────────────────────
  if (action === 'submit') {
    if (!prompt) return res.status(400).json({ error: 'prompt requerido' });

    const body = {
      model: 'seedance-2.0',
      prompt,
      aspect_ratio: aspect_ratio || '9:16',
      duration: duration || 10,
      resolution: resolution || '1080p',
      audio: true,
    };

    if (style) body.style = style;

    // image-to-video si se provee imagen de referencia
    if (reference_image_url) {
      body.reference_image_url = reference_image_url;
    }

    const submitRes = await fetch('https://api.byteplus.com/seedance/v1/videos', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${BYTEPLUS_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!submitRes.ok) {
      const err = await submitRes.text();
      return res.status(submitRes.status).json({ error: err });
    }

    const data = await submitRes.json();
    return res.json({ job_id: data.job_id });
  }

  return res.status(400).json({ error: 'action inválida. Usa submit o status' });
}

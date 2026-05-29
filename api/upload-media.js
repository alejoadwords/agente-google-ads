// api/upload-media.js
// Sube un archivo base64 al CDN de fal.ai y devuelve una URL pública permanente
// Usa la misma infraestructura que generate-image.js (fal-cdn-v3)
// Body: { base64, mediaType, fileName }
// Response: { url }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { base64, mediaType = 'image/jpeg', fileName } = req.body;
  if (!base64) return res.status(400).json({ error: 'base64 requerido' });

  const falKey = process.env.FAL_API_KEY;
  if (!falKey) return res.status(500).json({ error: 'FAL_API_KEY no configurado' });

  try {
    const buffer = Buffer.from(base64, 'base64');
    const ext    = mediaType.includes('png') ? 'png' : mediaType.includes('gif') ? 'gif' : mediaType.includes('mp4') ? 'mp4' : 'jpg';
    const name   = fileName || `acuarius_pub_${Date.now()}.${ext}`;

    // Paso 1: iniciar upload — obtener URL pre-firmada y URL final del archivo
    const initiateRes = await fetch(
      'https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3',
      {
        method:  'POST',
        headers: {
          'Authorization': `Key ${falKey}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ file_name: name, content_type: mediaType }),
      }
    );

    const initiateData = await initiateRes.json();
    const uploadUrl    = initiateData.upload_url || initiateData.url;

    if (!initiateRes.ok || !uploadUrl || !initiateData.file_url) {
      return res.status(500).json({
        error: 'Error iniciando upload: ' + JSON.stringify(initiateData).slice(0, 300),
      });
    }

    // Paso 2: subir el binario con PUT a la URL pre-firmada
    const putRes = await fetch(uploadUrl, {
      method:  'PUT',
      headers: { 'Content-Type': mediaType },
      body:    buffer,
    });

    if (!putRes.ok) {
      const errTxt = await putRes.text().catch(() => '');
      return res.status(500).json({ error: 'Error subiendo archivo: ' + errTxt.slice(0, 300) });
    }

    return res.status(200).json({ url: initiateData.file_url });

  } catch (err) {
    console.error('upload-media error:', err);
    return res.status(500).json({ error: err.message || 'Error subiendo media' });
  }
}

// api/meta-ads.js
// Proxy para Meta Marketing API — lectura y escritura de campañas
// Body: { accessToken, adAccountId, endpoint, method, params }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { accessToken, adAccountId, endpoint, method = 'GET', params = {} } = req.body;

  if (!accessToken) return res.status(400).json({ error: 'accessToken requerido' });
  if (!endpoint)    return res.status(400).json({ error: 'endpoint requerido' });

  const BASE = 'https://graph.facebook.com/v19.0';

  try {
    let url, fetchOpts;

    if (method === 'GET') {
      const qs = new URLSearchParams({ ...params, access_token: accessToken });
      url = `${BASE}/${endpoint}?${qs}`;
      fetchOpts = { method: 'GET' };
    } else {
      url = `${BASE}/${endpoint}`;
      fetchOpts = {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, access_token: accessToken }),
      };
    }

    const apiRes  = await fetch(url, fetchOpts);
    const apiData = await apiRes.json();

    if (apiData.error) {
      console.error('Meta API error:', apiData.error);
      return res.status(400).json({ error: apiData.error.message, code: apiData.error.code });
    }

    return res.status(200).json(apiData);

  } catch (err) {
    console.error('meta-ads proxy error:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}

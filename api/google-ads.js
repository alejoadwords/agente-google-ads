// api/google-ads.js
// Proxy seguro para llamadas a Google Ads API
// El frontend envía: { customerId, query } 
// Este endpoint agrega el developer token y el access token

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { customerId, query, accessToken } = req.body;

  if (!customerId || !query || !accessToken) {
    return res.status(400).json({ error: 'customerId, query y accessToken son requeridos' });
  }

  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

  // Limpiar customer ID (remover guiones)
  const cleanCustomerId = customerId.replace(/-/g, '');

  try {
    const response = await fetch(
      `https://googleads.googleapis.com/v18/customers/${cleanCustomerId}/googleAds:searchStream`,
      {
        method: 'POST',
        headers: {
          'Authorization':       `Bearer ${accessToken}`,
          'developer-token':     developerToken,
          'Content-Type':        'application/json',
          // Si usas MCC, agrega login-customer-id:
          // 'login-customer-id': process.env.GOOGLE_ADS_MCC_ID,
        },
        body: JSON.stringify({ query }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('Google Ads API error:', data);
      return res.status(response.status).json({ 
        error: 'Error en Google Ads API', 
        details: data 
      });
    }

    return res.status(200).json({ results: data });

  } catch (err) {
    console.error('google-ads proxy error:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}

// api/list-accounts.js
// Recibe el access_token del frontend y devuelve las cuentas
// accesibles bajo el MCC usando Google Ads API v18

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { accessToken } = req.body;

  if (!accessToken) {
    return res.status(400).json({ error: 'accessToken es requerido' });
  }

  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const mccId          = process.env.GOOGLE_ADS_MCC_ID; // "2432598177" sin guiones

  if (!developerToken || !mccId) {
    return res.status(500).json({ error: 'Variables de entorno de Google Ads no configuradas' });
  }

  // Limpiar MCC ID (quitar guiones si los tiene)
  const cleanMccId = mccId.replace(/-/g, '');

  try {
    // Query GAQL: listar todas las cuentas accesibles bajo el MCC
    const query = `
      SELECT
        customer_client.client_customer,
        customer_client.descriptive_name,
        customer_client.currency_code,
        customer_client.time_zone,
        customer_client.manager,
        customer_client.test_account,
        customer_client.status,
        customer_client.id
      FROM customer_client
      WHERE customer_client.level = 1
        AND customer_client.status = 'ENABLED'
    `;

    const response = await fetch(
      `https://googleads.googleapis.com/v18/customers/${cleanMccId}/googleAds:searchStream`,
      {
        method: 'POST',
        headers: {
          'Authorization':    `Bearer ${accessToken}`,
          'developer-token':  developerToken,
          'login-customer-id': cleanMccId,
          'Content-Type':     'application/json',
        },
        body: JSON.stringify({ query }),
      }
    );

    // searchStream devuelve un array de objetos con resultados
    const rawText = await response.text();

    if (!response.ok) {
      console.error('Google Ads list-accounts error:', rawText);

      // Si el developer token está en Test Access, solo puede ver
      // cuentas de prueba — informamos claramente
      if (rawText.includes('DEVELOPER_TOKEN_NOT_APPROVED')) {
        return res.status(403).json({
          error: 'developer_token_not_approved',
          message: 'El developer token aún está en Test Access. Solo puedes ver cuentas de prueba hasta que Google apruebe el acceso Basic.',
        });
      }

      return res.status(response.status).json({
        error: 'Error en Google Ads API',
        details: rawText,
      });
    }

    // searchStream devuelve un JSON array (una respuesta por "página")
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return res.status(500).json({ error: 'Respuesta inesperada de Google Ads API' });
    }

    // Aplanar resultados (searchStream devuelve array de batches)
    const rows = Array.isArray(parsed)
      ? parsed.flatMap(batch => batch.results || [])
      : (parsed.results || []);

    const accounts = rows.map(row => {
      const cc = row.customerClient;
      return {
        id:         cc.id?.toString() || cc.clientCustomer?.split('/').pop() || '',
        name:       cc.descriptiveName || '(sin nombre)',
        currency:   cc.currencyCode || '',
        timezone:   cc.timeZone || '',
        isManager:  cc.manager === true,
        isTest:     cc.testAccount === true,
        resourceName: cc.clientCustomer || '',
      };
    });

    // Ordenar: primero no-manager, luego manager; dentro de cada grupo por nombre
    accounts.sort((a, b) => {
      if (a.isManager !== b.isManager) return a.isManager ? 1 : -1;
      return a.name.localeCompare(b.name);
    });

    return res.status(200).json({ accounts });

  } catch (err) {
    console.error('list-accounts error:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}

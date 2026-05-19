// api/list-accounts.js
// Lista todas las cuentas de Google Ads accesibles con el token del usuario
// Si es MCC, devuelve las cuentas hija. Si es cuenta individual, devuelve esa sola.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { accessToken } = req.body;
  if (!accessToken) return res.status(400).json({ error: 'accessToken requerido' });

  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const mccId = (process.env.GOOGLE_ADS_MCC_ID || '').replace(/-/g, '');

  const baseHeaders = {
    'Authorization':   `Bearer ${accessToken}`,
    'developer-token': developerToken,
    ...(mccId ? { 'login-customer-id': mccId } : {}),
  };

  try {
    // 1. Obtener todas las cuentas accesibles con el token
    const listRes = await fetch(
      'https://googleads.googleapis.com/v18/customers:listAccessibleCustomers',
      { headers: baseHeaders }
    );

    const listData = await listRes.json();
    console.log('listAccessibleCustomers status:', listRes.status, JSON.stringify(listData).slice(0, 400));

    if (!listRes.ok || !listData.resourceNames) {
      // Extraer el mensaje de error real de Google para poder diagnosticar
      const googleError = listData?.error?.message
        || listData?.error?.details?.[0]?.errors?.[0]?.message
        || JSON.stringify(listData).slice(0, 200);
      return res.status(200).json({
        accounts: [],
        isMCC: false,
        googleError,
      });
    }

    // 2. Para cada resource name, obtener detalles de la cuenta
    const resourceNames = listData.resourceNames; // ["customers/123456", ...]
    const customerIds = resourceNames.map(r => r.replace('customers/', ''));

    const accountDetails = await Promise.all(
      customerIds.map(async (id) => {
        try {
          // Consultar nombre, moneda, zona horaria y si es MCC
          const queryRes = await fetch(
            `https://googleads.googleapis.com/v18/customers/${id}/googleAds:search`,
            {
              method: 'POST',
              headers: {
                ...baseHeaders,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                query: `SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager, customer.test_account FROM customer LIMIT 1`
              }),
            }
          );

          const qData = await queryRes.json();
          const row = qData.results?.[0]?.customer;

          if (!row) return null;

          return {
            id:          row.id,
            name:        row.descriptiveName || `Cuenta ${row.id}`,
            currency:    row.currencyCode || 'USD',
            timezone:    row.timeZone || '',
            isManager:   row.manager || false,
            isTest:      row.testAccount || false,
          };
        } catch {
          return null;
        }
      })
    );

    const accounts = accountDetails.filter(Boolean);

    // 3. Separar MCCs de cuentas normales
    const hasManager = accounts.some(a => a.isManager);

    return res.status(200).json({
      accounts,
      isMCC: hasManager,
      total: accounts.length,
    });

  } catch (err) {
    console.error('list-accounts error:', err);
    return res.status(500).json({ error: 'Error consultando cuentas', details: err.message });
  }
}

// api/list-accounts.js
// Lista todas las cuentas de Google Ads accesibles con el token del usuario

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { accessToken } = req.body;
  if (!accessToken) return res.status(400).json({ error: 'accessToken requerido' });

  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const mccId = (process.env.GOOGLE_ADS_MCC_ID || '').replace(/-/g, '');

  try {
    // 1. listAccessibleCustomers — NO usar login-customer-id aquí
    const listRes = await fetch(
      'https://googleads.googleapis.com/v18/customers:listAccessibleCustomers',
      {
        headers: {
          'Authorization':   `Bearer ${accessToken}`,
          'developer-token': developerToken,
        },
      }
    );

    const listData = await listRes.json();
    const statusCode = listRes.status;
    console.log('listAccessibleCustomers status:', statusCode, JSON.stringify(listData).slice(0, 500));

    // Error HTTP de Google
    if (!listRes.ok) {
      const googleError = listData?.error?.message
        || listData?.error?.status
        || JSON.stringify(listData).slice(0, 300);
      return res.status(200).json({
        accounts: [], isMCC: false,
        googleError: `[HTTP ${statusCode}] ${googleError}`,
        debug: { step: 'listAccessibleCustomers', status: statusCode, body: listData },
      });
    }

    // Sin cuentas accesibles
    if (!listData.resourceNames || listData.resourceNames.length === 0) {
      return res.status(200).json({
        accounts: [], isMCC: false,
        googleError: `El token no tiene acceso a ninguna cuenta. Verifica que la cuenta ${accessToken.slice(0,10)}... esté vinculada al MCC y que el developer token tenga acceso a producción (no test mode).`,
        debug: { step: 'listAccessibleCustomers', resourceNames: listData.resourceNames },
      });
    }

    // 2. Para cada resource name, obtener detalles
    const resourceNames = listData.resourceNames;
    const customerIds = resourceNames.map(r => r.replace('customers/', ''));

    const accountDetails = await Promise.all(
      customerIds.map(async (id) => {
        try {
          // Usar login-customer-id del MCC solo para queries a sub-cuentas
          const headers = {
            'Authorization':   `Bearer ${accessToken}`,
            'developer-token': developerToken,
            'Content-Type':    'application/json',
          };
          if (mccId && mccId !== id) headers['login-customer-id'] = mccId;

          const queryRes = await fetch(
            `https://googleads.googleapis.com/v18/customers/${id}/googleAds:search`,
            {
              method: 'POST',
              headers,
              body: JSON.stringify({
                query: `SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager, customer.test_account FROM customer LIMIT 1`
              }),
            }
          );

          const qData = await queryRes.json();
          if (!queryRes.ok) {
            console.log(`Customer ${id} query error:`, queryRes.status, JSON.stringify(qData).slice(0, 200));
            return null;
          }
          const row = qData.results?.[0]?.customer;
          if (!row) return null;

          return {
            id:        row.id,
            name:      row.descriptiveName || `Cuenta ${row.id}`,
            currency:  row.currencyCode || 'USD',
            timezone:  row.timeZone || '',
            isManager: row.manager || false,
            isTest:    row.testAccount || false,
          };
        } catch {
          return null;
        }
      })
    );

    const accounts = accountDetails.filter(Boolean);
    const hasManager = accounts.some(a => a.isManager);

    // Si no se pudo obtener detalle de ninguna cuenta, explicar
    if (accounts.length === 0) {
      return res.status(200).json({
        accounts: [], isMCC: false,
        googleError: `Se encontraron ${customerIds.length} cuentas (${customerIds.join(', ')}) pero no se pudo consultar su detalle. El developer token puede estar en modo prueba (test), que solo permite acceder a cuentas de prueba.`,
        debug: { step: 'customerQuery', customerIds },
      });
    }

    return res.status(200).json({ accounts, isMCC: hasManager, total: accounts.length });

  } catch (err) {
    console.error('list-accounts error:', err);
    return res.status(500).json({ error: 'Error consultando cuentas', details: err.message });
  }
}

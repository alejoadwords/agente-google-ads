// api/list-accounts.js
// Lista todas las cuentas de Google Ads accesibles con el token del usuario

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { accessToken } = req.body;
  if (!accessToken) return res.status(400).json({ error: 'accessToken requerido' });

  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const mccId = (process.env.GOOGLE_ADS_MCC_ID || '').replace(/-/g, '');

  // Intentar con versiones en orden descendente hasta encontrar una que responda
  async function tryListAccessible(version) {
    return fetch(
      `https://googleads.googleapis.com/v${version}/customers:listAccessibleCustomers`,
      { headers: { 'Authorization': `Bearer ${accessToken}`, 'developer-token': developerToken } }
    );
  }

  try {
    // 1. listAccessibleCustomers — probar v20, v19, v18 en ese orden
    let listRes;
    for (const ver of [20, 19, 18]) {
      const r = await tryListAccessible(ver);
      if (r.status !== 404) { listRes = r; break; }
    }
    if (!listRes) {
      return res.status(200).json({ accounts: [], isMCC: false, googleError: 'API de Google Ads no disponible (todas las versiones devuelven 404). Verifica el developer token.' });
    }

    const statusCode = listRes.status;
    const rawText = await listRes.text();
    let listData = {};
    try { listData = JSON.parse(rawText); } catch { listData = { _raw: rawText.slice(0, 200) }; }
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
            `https://googleads.googleapis.com/v20/customers/${id}/googleAds:search`,
            {
              method: 'POST',
              headers,
              body: JSON.stringify({
                query: `SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager, customer.test_account FROM customer LIMIT 1`
              }),
            }
          );

          const qRaw = await queryRes.text();
          let qData = {};
          try { qData = JSON.parse(qRaw); } catch { return null; }
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

    // Si no se pudo obtener detalle de ninguna cuenta, explicar
    if (accounts.length === 0) {
      return res.status(200).json({
        accounts: [], isMCC: false,
        googleError: `Se encontraron ${customerIds.length} cuentas (${customerIds.join(', ')}) pero no se pudo consultar su detalle. El developer token puede estar en modo prueba (test), que solo permite acceder a cuentas de prueba.`,
        debug: { step: 'customerQuery', customerIds },
      });
    }

    // Separar MCCs de cuentas normales
    const mccAccounts = accounts.filter(a => a.isManager);
    const nonMccAccounts = accounts.filter(a => !a.isManager);

    // Para cada MCC, consultar sus sub-cuentas (level = 1)
    const subAccountsArrays = await Promise.all(
      mccAccounts.map(async (mcc) => {
        try {
          const queryRes = await fetch(
            `https://googleads.googleapis.com/v20/customers/${mcc.id}/googleAds:search`,
            {
              method: 'POST',
              headers: {
                'Authorization':    `Bearer ${accessToken}`,
                'developer-token':  developerToken,
                'login-customer-id': String(mcc.id),
                'Content-Type':     'application/json',
              },
              body: JSON.stringify({
                query: 'SELECT customer_client.client_customer, customer_client.descriptive_name, customer_client.id, customer_client.currency_code, customer_client.time_zone, customer_client.manager, customer_client.test_account, customer_client.level FROM customer_client WHERE customer_client.level = 1 ORDER BY customer_client.id',
              }),
            }
          );
          const qRaw = await queryRes.text();
          let qData = {};
          try { qData = JSON.parse(qRaw); } catch { return []; }
          if (!queryRes.ok) {
            console.log(`MCC ${mcc.id} customer_client query error:`, queryRes.status, JSON.stringify(qData).slice(0, 200));
            return [];
          }
          return (qData.results || []).map(row => {
            const cc = row.customerClient;
            if (!cc) return null;
            return {
              id:        cc.id,
              name:      cc.descriptiveName || `Cuenta ${cc.id}`,
              currency:  cc.currencyCode || 'USD',
              timezone:  cc.timeZone || '',
              isManager: cc.manager || false,
              isTest:    cc.testAccount || false,
            };
          }).filter(Boolean);
        } catch (e) {
          console.log(`MCC ${mcc.id} sub-accounts error:`, e.message);
          return [];
        }
      })
    );

    const subAccounts = subAccountsArrays.flat();

    // Combinar: cuentas no-MCC directas + sub-cuentas de todos los MCCs
    const combined = [...nonMccAccounts, ...subAccounts];

    // Si hay sub-cuentas, devolverlas; si no, devolver los MCCs como fallback
    const finalAccounts = combined.length > 0 ? combined : mccAccounts;
    const hasManager = mccAccounts.length > 0;

    return res.status(200).json({ accounts: finalAccounts, isMCC: hasManager, total: finalAccounts.length });

  } catch (err) {
    console.error('list-accounts error:', err);
    return res.status(200).json({
      accounts: [], isMCC: false,
      googleError: `Error interno: ${err.message}`,
      details: err.message,
    });
  }
}

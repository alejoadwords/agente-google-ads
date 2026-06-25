// api/list-accounts.js
// Lista todas las cuentas de Google Ads accesibles con el token del usuario

const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function getStoredConnection(userId) {
  if (!userId || !SUPABASE_URL) return null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/platform_connections?user_id=eq.${encodeURIComponent(userId)}&platform=eq.google_ads&select=access_token,refresh_token`,
      { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
    );
    const rows = await r.json();
    return rows?.[0] || null;
  } catch { return null; }
}

async function refreshGoogleToken(refreshToken) {
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type:    'refresh_token',
      }),
    });
    return r.json();
  } catch { return {}; }
}

async function updateStoredToken(userId, accessToken) {
  if (!SUPABASE_URL) return;
  await fetch(
    `${SUPABASE_URL}/rest/v1/platform_connections?user_id=eq.${encodeURIComponent(userId)}&platform=eq.google_ads`,
    {
      method: 'PATCH',
      headers: {
        'apikey':        SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ access_token: accessToken, updated_at: new Date().toISOString() }),
    }
  ).catch(() => {});
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let { accessToken, userId } = req.body || {};

  // Si no hay token en el body, obtenerlo de Supabase
  if (!accessToken && userId) {
    const conn = await getStoredConnection(userId);
    accessToken = conn?.access_token || null;
  }
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

  // Auto-refresh si hay 401: obtener refresh_token de Supabase y renovar
  async function tryRefreshAndRetry() {
    if (!userId) return false;
    const conn = await getStoredConnection(userId);
    if (!conn?.refresh_token) return false;
    const refreshed = await refreshGoogleToken(conn.refresh_token);
    if (!refreshed.access_token) return false;
    accessToken = refreshed.access_token;
    await updateStoredToken(userId, accessToken);
    return true;
  }

  try {
    // 1. listAccessibleCustomers — probar versiones en orden descendente
    // Tratar tanto 404 como UNSUPPORTED_VERSION como "prueba la siguiente versión"
    let listRes;
    for (const ver of [22, 21, 20, 19, 18]) {
      const r = await tryListAccessible(ver);
      if (r.status === 404) continue;
      // Check for deprecated/unsupported version (400 with UNSUPPORTED_VERSION)
      if (r.status === 400) {
        const body = await r.clone().json().catch(() => ({}));
        const isUnsupported = JSON.stringify(body).includes('UNSUPPORTED_VERSION');
        if (isUnsupported) continue;
      }
      listRes = r; break;
    }
    if (!listRes) {
      return res.status(200).json({ accounts: [], isMCC: false, googleError: 'API de Google Ads no disponible (todas las versiones están deprecadas o no responden). Verifica el developer token.' });
    }

    // Si el token expiró (401), intentar refresh y repetir
    if (listRes.status === 401) {
      const refreshed = await tryRefreshAndRetry();
      if (refreshed) {
        // Reintento con token renovado
        listRes = null;
        for (const ver of [20, 19, 18]) {
          const r = await tryListAccessible(ver);
          if (r.status !== 404) { listRes = r; break; }
        }
        if (!listRes) {
          return res.status(200).json({ accounts: [], isMCC: false, googleError: 'API no disponible después de renovar el token.' });
        }
      } else {
        // Refresh falló — pedir reconexión
        console.log('list-accounts: token 401 y refresh fallido, userId:', userId);
        return res.status(200).json({
          accounts: [], isMCC: false,
          googleError: 'Tu sesión de Google Ads expiró. Reconecta tu cuenta en Configuración → Conexiones → Google Ads.',
          needsReconnect: true,
        });
      }
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
      // Include details array for better debugging (e.g. fieldViolations)
      const details = listData?.error?.details
        ? JSON.stringify(listData.error.details).slice(0, 400)
        : null;
      const fullMsg = details
        ? `[HTTP ${statusCode}] ${googleError} | details: ${details}`
        : `[HTTP ${statusCode}] ${googleError}`;
      return res.status(200).json({
        accounts: [], isMCC: false,
        googleError: fullMsg,
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

    const customerErrors = [];
    const accountDetails = await Promise.all(
      customerIds.map(async (id) => {
        try {
          // Strategy 1: GET /customers/{id} — simple REST endpoint, no GAQL needed
          // Try with different login-customer-id values
          const loginIds = [];
          if (mccId && mccId !== id) loginIds.push(mccId);
          loginIds.push(id);
          loginIds.push(null);

          for (const loginId of loginIds) {
            const headers = {
              'Authorization':   `Bearer ${accessToken}`,
              'developer-token': developerToken,
            };
            if (loginId) headers['login-customer-id'] = loginId;

            const getRes = await fetch(
              `https://googleads.googleapis.com/v19/customers/${id}`,
              { headers }
            );

            const getRaw = await getRes.text();
            let getData = {};
            try { getData = JSON.parse(getRaw); } catch {
              customerErrors.push(`GET ${id}(login:${loginId}): non-JSON [${getRes.status}] ${getRaw.slice(0, 80)}`);
              continue;
            }
            if (!getRes.ok) {
              const errMsg = getData?.error?.message || JSON.stringify(getData).slice(0, 200);
              customerErrors.push(`GET ${id}(login:${loginId}): ${getRes.status} ${errMsg}`);
              continue;
            }
            // Success — getData is a Customer resource
            return {
              id:        getData.id || id,
              name:      getData.descriptiveName || `Cuenta ${id}`,
              currency:  getData.currencyCode || 'USD',
              timezone:  getData.timeZone || '',
              isManager: getData.manager || false,
              isTest:    getData.testAccount || false,
            };
          }

          // Strategy 2: fallback to googleAds:search if GET failed for all loginIds
          for (const loginId of [mccId || null, null]) {
            const headers = {
              'Authorization':   `Bearer ${accessToken}`,
              'developer-token': developerToken,
              'Content-Type':    'application/json',
            };
            if (loginId) headers['login-customer-id'] = loginId;

            const queryRes = await fetch(
              `https://googleads.googleapis.com/v19/customers/${id}/googleAds:search`,
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
            try { qData = JSON.parse(qRaw); } catch {
              customerErrors.push(`SEARCH ${id}(login:${loginId}): non-JSON [${queryRes.status}] ${qRaw.slice(0, 80)}`);
              continue;
            }
            if (!queryRes.ok) {
              const errMsg = qData?.error?.message || JSON.stringify(qData).slice(0, 200);
              customerErrors.push(`SEARCH ${id}(login:${loginId}): ${queryRes.status} ${errMsg}`);
              continue;
            }
            const row = qData.results?.[0]?.customer;
            if (!row) {
              customerErrors.push(`SEARCH ${id}(login:${loginId}): ok but no results`);
              continue;
            }
            return {
              id:        row.id,
              name:      row.descriptiveName || `Cuenta ${row.id}`,
              currency:  row.currencyCode || 'USD',
              timezone:  row.timeZone || '',
              isManager: row.manager || false,
              isTest:    row.testAccount || false,
            };
          }

          // Fallback: can't get details but account is accessible — use ID as name
          console.log(`Customer ${id}: all detail queries failed, using fallback entry. Errors: ${customerErrors.slice(-4).join(' | ')}`);
          return { id, name: `Cuenta ${id}`, currency: 'USD', timezone: '', isManager: false, isTest: false, _fallback: true };
        } catch (e) {
          customerErrors.push(`${id}: exception ${e.message}`);
          // Still return a fallback entry so the account is usable
          return { id, name: `Cuenta ${id}`, currency: 'USD', timezone: '', isManager: false, isTest: false, _fallback: true };
        }
      })
    );

    const accounts = accountDetails.filter(Boolean);

    // Separar MCCs de cuentas normales
    const mccAccounts = accounts.filter(a => a.isManager);
    const nonMccAccounts = accounts.filter(a => !a.isManager);

    // Para cada MCC, consultar sus sub-cuentas (level = 1)
    const subAccountsArrays = await Promise.all(
      mccAccounts.map(async (mcc) => {
        try {
          const queryRes = await fetch(
            `https://googleads.googleapis.com/v19/customers/${mcc.id}/googleAds:search`,
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

// api/list-accounts.js
// Recibe el access_token del usuario y devuelve sus cuentas de Google Ads.
// Funciona para cualquier usuario: cuentas individuales, MCC propios, o cuentas
// a las que tienen acceso. No depende del MCC de Acuarius.
//
// Flujo:
// 1. customers:listAccessibleCustomers  →  obtiene resource names del usuario
// 2. Por cada customer obtiene detalles (nombre, moneda, etc.)
// 3. Si alguna cuenta es MCC, expande sus sub-cuentas nivel 1

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { accessToken } = req.body;

  if (!accessToken) {
    return res.status(400).json({ error: 'accessToken es requerido' });
  }

  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

  if (!developerToken) {
    return res.status(500).json({ error: 'GOOGLE_ADS_DEVELOPER_TOKEN no configurado' });
  }

  try {
    // ── Paso 1: listar customers accesibles por este usuario ──────────────
    const listRes = await fetch(
      'https://googleads.googleapis.com/v18/customers:listAccessibleCustomers',
      {
        method: 'GET',
        headers: {
          'Authorization':   `Bearer ${accessToken}`,
          'developer-token': developerToken,
        },
      }
    );

    const listText = await listRes.text();

    if (!listRes.ok) {
      console.error('listAccessibleCustomers error:', listText);
      if (listText.includes('DEVELOPER_TOKEN_NOT_APPROVED')) {
        return res.status(403).json({
          error: 'developer_token_not_approved',
          message: 'El developer token está en Test Access. Solo funciona con cuentas de prueba.',
        });
      }
      return res.status(listRes.status).json({
        error: 'Error listando cuentas de Google Ads',
        details: listText,
      });
    }

    const listData = JSON.parse(listText);
    const resourceNames = listData.resourceNames || [];

    if (resourceNames.length === 0) {
      return res.status(200).json({ accounts: [] });
    }

    // ── Paso 2: obtener detalles de cada cuenta ───────────────────────────
    const accountDetails = await Promise.all(
      resourceNames.map(async (resourceName) => {
        const customerId = resourceName.split('/').pop();
        try {
          const detailRes = await fetch(
            `https://googleads.googleapis.com/v18/customers/${customerId}/googleAds:search`,
            {
              method: 'POST',
              headers: {
                'Authorization':     `Bearer ${accessToken}`,
                'developer-token':   developerToken,
                'login-customer-id': customerId,
                'Content-Type':      'application/json',
              },
              body: JSON.stringify({
                query: `
                  SELECT
                    customer.id,
                    customer.descriptive_name,
                    customer.currency_code,
                    customer.time_zone,
                    customer.manager,
                    customer.test_account,
                    customer.status
                  FROM customer
                  LIMIT 1
                `,
              }),
            }
          );
          if (!detailRes.ok) return null;
          const detailData = await detailRes.json();
          const row = detailData.results?.[0]?.customer;
          if (!row) return null;
          return {
            id:        row.id?.toString() || customerId,
            name:      row.descriptiveName || '(sin nombre)',
            currency:  row.currencyCode || '',
            timezone:  row.timeZone || '',
            isManager: row.manager === true,
            isTest:    row.testAccount === true,
            status:    row.status || '',
          };
        } catch {
          return null;
        }
      })
    );

    // Filtrar nulos y canceladas/suspendidas
    let accounts = accountDetails.filter(
      a => a && a.status !== 'CANCELED' && a.status !== 'SUSPENDED'
    );

    // ── Paso 3: expandir sub-cuentas de MCCs ─────────────────────────────
    const subAccountsArrays = await Promise.all(
      accounts
        .filter(a => a.isManager)
        .map(async (mcc) => {
          try {
            const subRes = await fetch(
              `https://googleads.googleapis.com/v18/customers/${mcc.id}/googleAds:search`,
              {
                method: 'POST',
                headers: {
                  'Authorization':     `Bearer ${accessToken}`,
                  'developer-token':   developerToken,
                  'login-customer-id': mcc.id,
                  'Content-Type':      'application/json',
                },
                body: JSON.stringify({
                  query: `
                    SELECT
                      customer_client.id,
                      customer_client.descriptive_name,
                      customer_client.currency_code,
                      customer_client.time_zone,
                      customer_client.manager,
                      customer_client.test_account,
                      customer_client.status,
                      customer_client.level
                    FROM customer_client
                    WHERE customer_client.level = 1
                      AND customer_client.status = 'ENABLED'
                  `,
                }),
              }
            );
            if (!subRes.ok) return [];
            const subData = await subRes.json();
            return (subData.results || []).map(row => {
              const cc = row.customerClient;
              return {
                id:         cc.id?.toString() || '',
                name:       cc.descriptiveName || '(sin nombre)',
                currency:   cc.currencyCode || '',
                timezone:   cc.timeZone || '',
                isManager:  cc.manager === true,
                isTest:     cc.testAccount === true,
                parentMcc:  mcc.id,
                parentName: mcc.name,
              };
            });
          } catch {
            return [];
          }
        })
    );

    // Agregar sub-cuentas que no estén ya en la lista
    const existingIds = new Set(accounts.map(a => a.id));
    for (const sub of subAccountsArrays.flat()) {
      if (sub.id && !existingIds.has(sub.id)) {
        accounts.push(sub);
        existingIds.add(sub.id);
      }
    }

    // Ordenar: cuentas normales primero, MCC al final; dentro por nombre
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

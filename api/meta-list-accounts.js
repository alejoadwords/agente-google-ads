// api/meta-list-accounts.js
// Lista las cuentas publicitarias accesibles con el token del usuario

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { accessToken, userId } = req.body;
  if (!accessToken) return res.status(400).json({ error: 'accessToken requerido' });

  try {
    // Obtener cuentas publicitarias del usuario
    const accountsRes = await fetch(
      `https://graph.facebook.com/v19.0/me/adaccounts?` +
      new URLSearchParams({
        fields:       'id,name,currency,account_status,business,spend_cap,amount_spent',
        access_token: accessToken,
        limit:        '50',
      })
    );

    const data = await accountsRes.json();

    if (data.error) {
      return res.status(400).json({ error: data.error.message });
    }

    // Mapear cuentas con estado legible
    const statusMap = {
      1: 'activa', 2: 'desactivada', 3: 'sin confirmar',
      7: 'pendiente revisión', 9: 'en revisión', 100: 'cerrada',
      101: 'cualquier activa', 201: 'sin permiso de pago',
    };

    const accounts = (data.data || []).map(acc => ({
      id:       acc.id,           // formato: act_XXXXXXXXX
      name:     acc.name,
      currency: acc.currency,
      status:   statusMap[acc.account_status] || 'desconocido',
      isActive: acc.account_status === 1,
      business: acc.business?.name || null,
      spent:    acc.amount_spent ? (acc.amount_spent / 100).toFixed(2) : '0',
    }));

    return res.status(200).json({ accounts, total: accounts.length });

  } catch (err) {
    console.error('meta-list-accounts error:', err);
    return res.status(500).json({ error: 'Error consultando cuentas de Meta' });
  }
}

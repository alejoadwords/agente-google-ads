// api/_google-login.js — por qué administrador preguntar en Google Ads
//
// Google Ads exige la cabecera `login-customer-id` cuando la cuenta que se
// consulta cuelga de un administrador, y la rechaza cuando el administrador
// que se manda no es el suyo. Hay tres casos y solo uno se adivinaba:
//
//   1. La cuenta está a nombre del usuario → NO se manda cabecera.
//   2. Cuelga de NUESTRO administrador → se manda el nuestro.
//   3. Cuelga del administrador DEL CLIENTE → se manda el suyo.
//
// El tercero es el que rompía. `api/google-ads.js` probaba 1 y luego 2, y para
// una inmobiliaria cuya cuenta cuelga de su propio administrador devolvía «The
// caller does not have permission» — 18 veces entre el 16 y el 22-09-2026,
// desde la ficha de un lead.
//
// Esto ya estaba resuelto dentro de `api/pauta.js`; se saca aquí para que los
// dos lo usen en vez de tener uno la versión buena y otro la rota.
//
// OJO: `listAccessibleCustomers` devuelve solo las cuentas de PRIMERA mano —
// para la cuenta de Certain devolvía 11 y ninguna era la suya—. Por eso hay
// que bajar por `customer_client` desde cada administrador al que sí se llega.

/**
 * Devuelve el `login-customer-id` que hay que mandar, o null si no hace falta.
 * El resultado se guarda en la conexión: la búsqueda cuesta una llamada por
 * administrador y no cambia de un día para otro.
 *
 * @param {object} o
 * @param {object} o.fila      la fila de platform_connections (con id y extra_data)
 * @param {string} o.token     access token de Google, ya válido
 * @param {string} o.customerId la cuenta que se quiere consultar, sin guiones
 * @param {string} o.devToken  developer token
 * @param {string} o.sbUrl     URL de Supabase, para guardar el hallazgo
 * @param {string} o.sbKey     service key
 */
export async function dondePreguntar({ fila, token, customerId, devToken, sbUrl, sbKey }) {
  const cid = String(customerId || '').replace(/-/g, '');
  if (!cid || !token || !devToken) return null;

  // Lo averiguado se guarda POR CUENTA DE GOOGLE, no por conexión.
  //
  // La primera versión guardaba un solo `login_customer_id` en la conexión.
  // Vale para `api/pauta.js`, donde cada conexión es de un cliente. NO vale
  // aquí: una agencia tiene UNA conexión de Google que sirve a once cuentas,
  // y cada una puede colgar de un administrador distinto —o de ninguno—. Con
  // una sola casilla, la primera cuenta que se resolviera dejaría su
  // administrador puesto para todas las demás.
  //
  // Se mira primero el mapa por cuenta y luego la casilla vieja, que se
  // conserva para no volver a buscar lo que ya se sabía.
  const extra = fila?.extra_data || {};
  const porCuenta = extra.login_por_cuenta || {};
  const guardado = porCuenta[cid] !== undefined ? porCuenta[cid]
    : (extra.login_customer_id !== undefined && String(fila?.account_id || '') === cid ? extra.login_customer_id : undefined);
  if (guardado !== undefined && guardado !== null) return guardado || null;

  const h = { Authorization: `Bearer ${token}`, 'developer-token': devToken };
  let alcance = [];
  try {
    const la = await fetch('https://googleads.googleapis.com/v22/customers:listAccessibleCustomers', { headers: h });
    if (!la.ok) return null;   // sin poder mirar, que el llamador siga como antes
    alcance = ((await la.json()).resourceNames || []).map(n => n.split('/').pop());
  } catch { return null; }

  let elegido = null;
  if (alcance.includes(cid)) {
    elegido = '';              // se llega directo: no hace falta cabecera
  } else {
    for (const m of alcance) {
      try {
        const r = await fetch(`https://googleads.googleapis.com/v22/customers/${m}/googleAds:search`, {
          method: 'POST',
          headers: { ...h, 'Content-Type': 'application/json', 'login-customer-id': m },
          body: JSON.stringify({ query: 'SELECT customer_client.id FROM customer_client' }),
        });
        if (!r.ok) continue;
        const filas = (await r.json()).results || [];
        if (filas.some(x => String(x.customerClient?.id) === cid)) { elegido = m; break; }
      } catch { /* un administrador que no contesta no puede parar la búsqueda */ }
    }
    // No se encontró camino a esa cuenta. Se anota igualmente: sin esto, cada
    // carga de la pantalla repetiría la búsqueda entera —una llamada por
    // administrador— contra Google, para volver a fallar igual.
    if (elegido === null) {
      await guardar(fila, cid, null, sbUrl, sbKey);
      return null;
    }
  }

  await guardar(fila, cid, elegido, sbUrl, sbKey);
  return elegido || null;
}

// `null` significa «se buscó y no hay camino»; se guarda igual para no repetir
// la búsqueda. La cadena vacía significa «se llega directo, sin cabecera».
async function guardar(fila, cid, valor, sbUrl, sbKey) {
  if (!fila?.id || !sbUrl || !sbKey) return;
  const extra = fila.extra_data || {};
  await fetch(`${sbUrl}/rest/v1/platform_connections?id=eq.${fila.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', apikey: sbKey, Authorization: `Bearer ${sbKey}` },
    body: JSON.stringify({
      extra_data: { ...extra, login_por_cuenta: { ...(extra.login_por_cuenta || {}), [cid]: valor } },
    }),
  }).catch(() => {});
}

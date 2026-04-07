export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Firma JWT para Google OAuth2 (service account)
async function getAccessToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (!email || !rawKey) throw new Error('Service account credentials missing');

  // Limpiar la private key (Vercel puede escapar los \n)
  const privateKey = rawKey.replace(/\\n/g, '\n');

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: email,
    sub: 'ceo@acuarius.app',
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const encode = (obj) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const signingInput = `${encode(header)}.${encode(payload)}`;

  // Importar la clave privada RSA
  const keyData = privateKey
    .replace('-----BEGIN RSA PRIVATE KEY-----', '')
    .replace('-----END RSA PRIVATE KEY-----', '')
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');

  const binaryKey = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryKey.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const jwt = `${signingInput}.${sigB64}`;

  // Intercambiar JWT por access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error(`Token error: ${JSON.stringify(tokenData)}`);
  return tokenData.access_token;
}

// Parsear la parrilla markdown a filas de datos
function parseParrilla(markdownText) {
  const rows = [];
  const lines = markdownText.split('\n');

  for (const line of lines) {
    if (!line.includes('|')) continue;
    const cells = line.split('|').map(c => c.trim()).filter(c => c !== '');
    if (cells.length < 3) continue;
    // Saltar líneas de separador (---)
    if (cells.every(c => /^[-:]+$/.test(c))) continue;
    rows.push(cells);
  }

  return rows;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Body inválido' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const { parrilla, titulo, userEmail, negocio } = body;

  if (!parrilla) {
    return new Response(JSON.stringify({ error: 'Falta el contenido de la parrilla' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  try {
    const token = await getAccessToken();
    const authHeader = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    const sheetTitle = titulo || `Parrilla de contenido${negocio ? ' · ' + negocio : ''} · ${new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}`;

    // 1. Crear el Spreadsheet
    const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify({
        properties: { title: sheetTitle, locale: 'es_CO' },
        sheets: [{
          properties: { title: 'Parrilla', gridProperties: { frozenRowCount: 1 } }
        }]
      }),
    });

    const sheet = await createRes.json();
    if (!sheet.spreadsheetId) throw new Error(`No se pudo crear el Sheet: ${JSON.stringify(sheet)}`);

    const spreadsheetId = sheet.spreadsheetId;
    const sheetId = sheet.sheets[0].properties.sheetId;

    // 1b. Mover el Sheet a la carpeta compartida de Acuarius
    const FOLDER_ID = '1GbUmKxjsjyXeHgfMnquhu3imvaXcYENc';
    await fetch(`https://www.googleapis.com/drive/v3/files/${spreadsheetId}?addParents=${FOLDER_ID}&removeParents=root&fields=id,parents`, {
      method: 'PATCH',
      headers: authHeader,
    });

    // 2. Parsear y escribir datos
    const rows = parseParrilla(parrilla);

    // Si no hay tabla markdown, crear estructura base
    const dataRows = rows.length > 0 ? rows : [
      ['Semana', 'Día', 'Red', 'Formato', 'Tema / Idea', 'Necesita imagen'],
    ];

    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Parrilla!A1:Z100?valueInputOption=RAW`, {
      method: 'PUT',
      headers: authHeader,
      body: JSON.stringify({
        range: 'Parrilla!A1:Z100',
        majorDimension: 'ROWS',
        values: dataRows,
      }),
    });

    // 3. Dar formato: encabezado en azul, columnas anchas, texto legible
    const numCols = dataRows[0]?.length || 6;
    const formatRequests = [
      // Fondo azul en fila de encabezado
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: numCols },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.118, green: 0.169, blue: 0.8 },
              textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 11 },
              horizontalAlignment: 'CENTER',
              verticalAlignment: 'MIDDLE',
              wrapStrategy: 'WRAP',
            }
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
        }
      },
      // Filas de datos: texto legible, wrap, centrado vertical
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 1, endRowIndex: 100, startColumnIndex: 0, endColumnIndex: numCols },
          cell: {
            userEnteredFormat: {
              textFormat: { fontSize: 10 },
              verticalAlignment: 'MIDDLE',
              wrapStrategy: 'WRAP',
            }
          },
          fields: 'userEnteredFormat(textFormat,verticalAlignment,wrapStrategy)',
        }
      },
      // Alternar colores de filas (zebra) — filas pares gris claro
      ...Array.from({ length: 15 }, (_, i) => ({
        repeatCell: {
          range: { sheetId, startRowIndex: (i * 2) + 2, endRowIndex: (i * 2) + 3, startColumnIndex: 0, endColumnIndex: numCols },
          cell: { userEnteredFormat: { backgroundColor: { red: 0.961, green: 0.961, blue: 0.965 } } },
          fields: 'userEnteredFormat(backgroundColor)',
        }
      })),
      // Ancho de columnas: más espacio para "Tema / Idea"
      { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 90 }, fields: 'pixelSize' } },
      { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 80 }, fields: 'pixelSize' } },
      { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 100 }, fields: 'pixelSize' } },
      { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } },
      { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 4, endIndex: 5 }, properties: { pixelSize: 340 }, fields: 'pixelSize' } },
      { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 }, properties: { pixelSize: 130 }, fields: 'pixelSize' } },
      // Alto de fila de encabezado
      { updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 44 }, fields: 'pixelSize' } },
      // Bordes en toda la tabla
      {
        updateBorders: {
          range: { sheetId, startRowIndex: 0, endRowIndex: Math.max(dataRows.length, 2), startColumnIndex: 0, endColumnIndex: numCols },
          top:    { style: 'SOLID', width: 1, color: { red: 0.8, green: 0.8, blue: 0.8 } },
          bottom: { style: 'SOLID', width: 1, color: { red: 0.8, green: 0.8, blue: 0.8 } },
          left:   { style: 'SOLID', width: 1, color: { red: 0.8, green: 0.8, blue: 0.8 } },
          right:  { style: 'SOLID', width: 1, color: { red: 0.8, green: 0.8, blue: 0.8 } },
          innerHorizontal: { style: 'SOLID', width: 1, color: { red: 0.88, green: 0.88, blue: 0.88 } },
          innerVertical:   { style: 'SOLID', width: 1, color: { red: 0.88, green: 0.88, blue: 0.88 } },
        }
      },
    ];

    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify({ requests: formatRequests }),
    });

    // 4. Compartir con el usuario si hay email
    if (userEmail) {
      await fetch(`https://www.googleapis.com/drive/v3/files/${spreadsheetId}/permissions`, {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify({
          role: 'writer',
          type: 'user',
          emailAddress: userEmail,
          sendNotificationEmail: false,
        }),
      });
    }

    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

    return new Response(JSON.stringify({ url, spreadsheetId, title: sheetTitle }), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('create-sheet error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
}

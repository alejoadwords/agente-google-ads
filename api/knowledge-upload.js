// api/knowledge-upload.js
// Carga el inventario desde una hoja de cálculo, para los clientes cuya web no
// es WordPress —o que no tienen web y llevan todo en un Excel—.
//
// El archivo se lee en el NAVEGADOR y aquí llegan ya las filas en JSON: subir
// el archivo entero por una función de Vercel se topa con su límite de cuerpo, y
// además obligaría a traer un lector de Excel al servidor.
export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const LOTE = 400;
const MAX_FILAS = 5000;

function sb() {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Prefer: 'return=representation',
  };
}

async function getUserId(req) {
  const auth = req.headers.get('Authorization');
  if (!auth) return null;
  const token = auth.replace('Bearer ', '');
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [hB64, pB64, sB64] = parts;
    const header = JSON.parse(atob(hB64.replace(/-/g, '+').replace(/_/g, '/')));
    const jwks = await fetch('https://clerk.acuarius.app/.well-known/jwks.json').then(r => r.json());
    const key = jwks.keys?.find(k => k.kid === header.kid);
    if (!key) return null;
    const ck = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const sig = Uint8Array.from(atob(sB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const data = new TextEncoder().encode(`${hB64}.${pB64}`);
    if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', ck, sig, data)) return null;
    const payload = JSON.parse(atob(pB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub || null;
  } catch { return null; }
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

const txt = v => { const s = String(v ?? '').trim(); return s ? s.slice(0, 200) : null; };

// «$ 1.235.440», «1,235,440», «1235440», «1.235.440 COP», «2500000,50».
//
// Un Excel exportado en configuración regional de EE. UU. escribe los miles con
// coma. Tratar solo el punto como separador de miles convertía «1,235,440» en
// 1 — y el agente habría ofrecido un apartamento por un peso, sin que nada
// fallara. Aquí se decide por la POSICIÓN: un separador seguido de exactamente
// tres dígitos y nada más detrás es de miles; si le siguen una o dos cifras, es
// el decimal.
function precio(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;

  let s = String(v).replace(/[^\d,.]/g, '');
  if (!s) return null;

  const ultimoPunto = s.lastIndexOf('.');
  const ultimaComa = s.lastIndexOf(',');
  const corte = Math.max(ultimoPunto, ultimaComa);

  if (corte === -1) {
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  const cola = s.length - corte - 1;              // dígitos tras el último separador
  const esDecimal = cola > 0 && cola <= 2;        // 3 dígitos = grupo de miles
  const entera = (esDecimal ? s.slice(0, corte) : s).replace(/[.,]/g, '');
  const decimal = esDecimal ? s.slice(corte + 1) : '';
  const n = parseFloat(entera + (decimal ? '.' + decimal : ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(String(v).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

// Arriendo / venta, escrito de las mil maneras en que lo escribe la gente.
function operacion(v) {
  const s = String(v || '').toLowerCase();
  if (!s) return null;
  if (/arrend|arrien|alquil|renta|rent/.test(s)) return 'arriendo';
  if (/vent|vend|compra|sale/.test(s)) return 'venta';
  return txt(v);
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return jsonResp({ error: 'Método no permitido' }, 405);

  try {
    let userId = await getUserId(req);
    if (!userId) return jsonResp({ error: 'No autorizado' }, 401);
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id&limit=1`, { headers: sb() });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const tw = (await r.json())?.[0];
      if (tw && tw.owner_user_id) userId = tw.owner_user_id;
    } catch {
      return jsonResp({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503);
    }

    const body = await req.json().catch(() => ({}));
    const clientId = body.client_id || null;
    const filasCrudas = Array.isArray(body.filas) ? body.filas : [];
    const reemplazar = body.reemplazar === true;
    const nombreArchivo = String(body.archivo || 'hoja de cálculo').slice(0, 120);

    if (!clientId) return jsonResp({ error: 'Falta el cliente' }, 400);
    if (!filasCrudas.length) return jsonResp({ error: 'El archivo no tiene filas con datos' }, 400);
    if (filasCrudas.length > MAX_FILAS) {
      return jsonResp({ error: `El archivo trae ${filasCrudas.length} filas y el máximo es ${MAX_FILAS}. Súbelo por partes.` }, 400);
    }

    const ahora = new Date().toISOString();
    const filas = [];
    let sinCodigo = 0;
    for (const f of filasCrudas) {
      const codigo = txt(f.codigo);
      // Sin código no hay forma de identificar la propiedad ni de actualizarla
      // en la siguiente carga: se cuenta y se dice, no se inventa uno.
      if (!codigo) { sinCodigo++; continue; }
      filas.push({
        user_id: userId, client_id: clientId, codigo,
        operacion: operacion(f.operacion),
        tipo: txt(f.tipo),
        ciudad: txt(f.ciudad),
        barrio: txt(f.barrio),
        habitaciones: num(f.habitaciones),
        banos: num(f.banos),
        estrato: num(f.estrato),
        precio: precio(f.precio),
        url: txt(f.url),
        modificado: ahora,
        visto_en: ahora,
      });
    }
    if (!filas.length) {
      return jsonResp({ error: 'Ninguna fila trae código. Revisa qué columna asignaste a «código».' }, 400);
    }

    // Un Excel repite códigos con facilidad. Postgres no deja tocar dos veces la
    // misma fila en una sentencia, así que el lote entero fallaría.
    const porCodigo = new Map();
    for (const f of filas) porCodigo.set(f.codigo, f);   // gana la última, que es lo que se espera al corregir abajo
    const unicas = [...porCodigo.values()];
    const repetidos = filas.length - unicas.length;

    // Reemplazar borra lo que ya había ANTES de meter lo nuevo. Sirve cuando el
    // Excel es el inventario completo y hay que quitar lo que ya no está.
    if (reemplazar) {
      const del = await fetch(
        `${SUPABASE_URL}/rest/v1/client_properties?user_id=eq.${encodeURIComponent(userId)}&client_id=eq.${encodeURIComponent(clientId)}`,
        { method: 'DELETE', headers: { ...sb(), Prefer: 'return=minimal' } }
      );
      if (!del.ok) {
        return jsonResp({ error: 'No se pudo vaciar el inventario anterior: ' + (await del.text()).slice(0, 200) }, 500);
      }
    }

    let guardadas = 0;
    for (let i = 0; i < unicas.length; i += LOTE) {
      const lote = unicas.slice(i, i + LOTE);
      const up = await fetch(`${SUPABASE_URL}/rest/v1/client_properties?on_conflict=user_id,client_id,codigo`, {
        method: 'POST',
        headers: { ...sb(), Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(lote),
      });
      if (!up.ok) {
        const det = (await up.text()).slice(0, 300);
        // Se dice cuántas SÍ entraron: con "error" a secas nadie sabe si tiene
        // medio inventario cargado o ninguno.
        return jsonResp({ error: `Se guardaron ${guardadas} y falló a partir de ahí: ${det}`, guardadas }, 500);
      }
      guardadas += lote.length;
    }

    // La fuente queda registrada para que el panel muestre de dónde salió el
    // inventario y cuándo. Sin base_url: no viene de ninguna web.
    const fila = {
      user_id: userId, client_id: clientId,
      base_url: null, post_type: 'archivo',
      ultimo_sync: ahora, ultimo_estado: 'ok', ultimo_error: null,
      mapeo: { origen: 'archivo', archivo: nombreArchivo, filas: guardadas },
    };
    const previa = await fetch(
      `${SUPABASE_URL}/rest/v1/client_knowledge_sources?user_id=eq.${encodeURIComponent(userId)}&client_id=eq.${encodeURIComponent(clientId)}&select=id&limit=1`,
      { headers: sb() }
    ).then(r => (r.ok ? r.json() : [])).catch(() => []);
    await (previa?.[0]
      ? fetch(`${SUPABASE_URL}/rest/v1/client_knowledge_sources?id=eq.${previa[0].id}`, { method: 'PATCH', headers: sb(), body: JSON.stringify(fila) })
      : fetch(`${SUPABASE_URL}/rest/v1/client_knowledge_sources`, { method: 'POST', headers: sb(), body: JSON.stringify(fila) })
    ).catch(() => {});

    const total = await fetch(
      `${SUPABASE_URL}/rest/v1/client_properties?user_id=eq.${encodeURIComponent(userId)}&client_id=eq.${encodeURIComponent(clientId)}&select=id`,
      { headers: { ...sb(), Prefer: 'count=exact', Range: '0-0' } }
    ).then(r => parseInt((r.headers.get('content-range') || '').split('/')[1] || '0', 10)).catch(() => guardadas);

    return jsonResp({
      ok: true,
      guardadas,
      repetidos,
      sin_codigo: sinCodigo,
      sin_precio: unicas.filter(f => !f.precio).length,
      total_inventario: total,
    });
  } catch (e) {
    return jsonResp({ error: 'No se pudo cargar el archivo: ' + (e?.message || 'error desconocido') }, 500);
  }
}

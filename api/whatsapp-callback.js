// api/whatsapp-callback.js
// Vuelta de la conexión de WhatsApp por redirección.
//
// Sin el SDK no llega el evento con waba_id/phone_number_id, así que hay que
// averiguarlos desde el token: 'debug_token' devuelve granular_scopes, y ahí el
// permiso whatsapp_business_management trae en target_ids las cuentas de
// WhatsApp que el usuario acaba de compartir con la app.
//
// Se conectan TODOS los números que traiga, cada uno como un canal. Con un solo
// número —el caso normal— eso es exactamente lo esperado, y con varios no
// obliga a elegir a ciegas antes de saber cuáles hay.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const GRAPH = 'https://graph.facebook.com/v21.0';
const APP = 'https://app.acuarius.app';

function sb(extra) {
  return {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
    ...(extra || {}),
  };
}

// Vuelve a la app contando qué pasó. Nunca se termina en una pantalla en blanco
// ni en un "conectado" que no sea verdad.
function volver(res, params) {
  const p = new URLSearchParams(params);
  return res.redirect(`${APP}/?${p}#wa`);
}

export default async function handler(req, res) {
  const { code, state, error, error_description } = req.query;

  let userId = '', agentId = '';
  try { const s = JSON.parse(state || '{}'); userId = s.userId || ''; agentId = s.agentId || ''; } catch {}

  if (error) return volver(res, { wa_error: error_description || error });
  if (!code) return volver(res, { wa_error: 'Meta no devolvió el código de autorización' });
  if (!userId) return volver(res, { wa_error: 'Se perdió la sesión durante la conexión. Vuelve a intentarlo.' });

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) return volver(res, { wa_error: 'Faltan las credenciales de la app de Meta' });

  try {
    // 0. Si quien conecta es un miembro del equipo, el canal es de la cuenta del
    //    DUEÑO. Sin esto quedaría colgado del miembro y el inbox —que sí
    //    resuelve al dueño— nunca encontraría la conexión: los mensajes
    //    entrarían y se descartarían por "canal no conectado".
    try {
      const tw = await fetch(`${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}` +
        `&status=eq.active&select=owner_user_id&limit=1`, { headers: sb() });
      if (!tw.ok) throw new Error('HTTP ' + tw.status);
      const fila = (await tw.json())?.[0];
      if (fila && fila.owner_user_id) userId = fila.owner_user_id;
    } catch {
      return volver(res, { wa_error: 'No se pudo verificar a qué cuenta pertenece el canal. Reintenta en unos segundos.' });
    }

    // 1. Código → token del negocio
    const tokRes = await fetch(`${GRAPH}/oauth/access_token?` + new URLSearchParams({
      client_id: appId, client_secret: appSecret,
      redirect_uri: `${APP}/api/whatsapp-callback`, code,
    }));
    const tok = await tokRes.json();
    if (!tok.access_token) {
      return volver(res, { wa_error: 'Meta rechazó el código: ' + (tok?.error?.message || 'sin detalle') });
    }
    const token = tok.access_token;

    // 2. ¿Qué cuentas de WhatsApp compartió? Salen de granular_scopes
    const dbg = await fetch(`${GRAPH}/debug_token?input_token=${encodeURIComponent(token)}` +
      `&access_token=${encodeURIComponent(appId + '|' + appSecret)}`).then(r => r.json());
    const scopes = dbg?.data?.granular_scopes || [];
    const wabaIds = [...new Set(
      scopes.filter(s => s.scope === 'whatsapp_business_management' || s.scope === 'whatsapp_business_messaging')
            .flatMap(s => s.target_ids || [])
    )];
    if (!wabaIds.length) {
      return volver(res, { wa_error: 'La conexión se completó pero Meta no compartió ninguna cuenta de WhatsApp Business. ' +
        'Suele significar que los permisos de WhatsApp aún no están aprobados para tu app (App Review).' });
    }

    // 3. Por cada cuenta: suscribirla a la app y guardar sus números
    let creados = 0, nombres = [];
    for (const waba of wabaIds) {
      const sub = await fetch(`${GRAPH}/${encodeURIComponent(waba)}/subscribed_apps`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!sub.ok) {
        const det = await sub.text().catch(() => '');
        // Sin suscripción el canal quedaría mudo: no se da por bueno
        return volver(res, { wa_error: 'Meta no aceptó la suscripción a los mensajes, así que no entrarían ' +
          'conversaciones. Detalle: ' + det.slice(0, 200) });
      }

      const nums = await fetch(`${GRAPH}/${encodeURIComponent(waba)}/phone_numbers?fields=id,display_phone_number,verified_name`, {
        headers: { 'Authorization': `Bearer ${token}` },
      }).then(r => r.json()).catch(() => ({}));
      const lista = nums?.data || [];
      if (!lista.length) {
        return volver(res, { wa_error: 'La cuenta de WhatsApp no tiene ningún número dado de alta todavía.' });
      }

      for (const n of lista) {
        const nombre = [n.verified_name, n.display_phone_number].filter(Boolean).join(' · ') || 'WhatsApp';
        // Reconectar actualiza en vez de duplicar
        const previa = await fetch(`${SUPABASE_URL}/rest/v1/channel_connections?user_id=eq.${encodeURIComponent(userId)}` +
          `&channel=eq.whatsapp&external_id=eq.${encodeURIComponent(n.id)}&select=id&limit=1`,
          { headers: sb() }).then(r => (r.ok ? r.json() : [])).catch(() => []);

        if (previa?.[0]?.id) {
          await fetch(`${SUPABASE_URL}/rest/v1/channel_connections?id=eq.${encodeURIComponent(previa[0].id)}`, {
            method: 'PATCH', headers: sb(),
            body: JSON.stringify({ access_token: token, channel_name: nombre, is_active: true }),
          });
        } else {
          await fetch(`${SUPABASE_URL}/rest/v1/channel_connections`, {
            method: 'POST', headers: sb(),
            body: JSON.stringify({
              user_id: userId,
              agent_id: agentId || null,   // sin agente = lo atiende el equipo
              channel: 'whatsapp',
              external_id: String(n.id),
              access_token: token,
              channel_name: nombre,
              is_active: true,
            }),
          });
        }
        creados++; nombres.push(nombre);
      }
    }

    return volver(res, { wa_ok: String(creados), wa_nombres: nombres.slice(0, 3).join(', ') });
  } catch (e) {
    return volver(res, { wa_error: 'No se pudo completar la conexión: ' + (e?.message || 'error desconocido') });
  }
}

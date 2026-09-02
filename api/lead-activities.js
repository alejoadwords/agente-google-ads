export const config = { runtime: 'edge' };
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'return=representation',
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
    const header = JSON.parse(atob(hB64.replace(/-/g,'+').replace(/_/g,'/')));
    const jwks = await fetch('https://clerk.acuarius.app/.well-known/jwks.json').then(r => r.json());
    const key = jwks.keys?.find(k => k.kid === header.kid);
    if (!key) return null;
    const cryptoKey = await crypto.subtle.importKey(
      'jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
    const sig = Uint8Array.from(atob(sB64.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0));
    const data = new TextEncoder().encode(`${hB64}.${pB64}`);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, data);
    if (!valid) return null;
    const payload = JSON.parse(atob(pB64.replace(/-/g,'+').replace(/_/g,'/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub || null;
  } catch { return null; }
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  let userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);

  // Equipo: los leads son del DUEÑO, así que sin esto un miembro no podía
  // registrar ni ver una sola actividad — la comprobación «este lead es tuyo»
  // fallaba siempre y devolvía 403. Quien actúa se guarda aparte para poder
  // firmar la actividad con su nombre.
  const actorId = userId;
  let actorNombre = null;
  // Quien no es miembro de ningún equipo ES el dueño, y el dueño manda siempre.
  let actorMandaEnLaCuenta = true;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id,member_name,member_email,role&limit=1`, { headers: sbHeaders() });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const tw = (await r.json())?.[0];
    if (tw && tw.owner_user_id) {
      userId = tw.owner_user_id;
      actorNombre = tw.member_name || tw.member_email || null;
      actorMandaEnLaCuenta = tw.role === 'admin';
    }
  } catch {
    return jsonResp({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503);
  }

  const url = new URL(req.url);

  // GET ?avisos=1 — las notas que la dirección me dejó y todavía no he visto.
  // Se filtra por metadata y no por una tabla aparte a propósito: la nota YA es
  // una actividad del lead, y duplicarla en otro sitio abre la puerta a que las
  // dos versiones dejen de contar lo mismo.
  if (req.method === 'GET' && url.searchParams.get('avisos') === '1') {
    const q = `${SUPABASE_URL}/rest/v1/lead_activities`
      + `?user_id=eq.${encodeURIComponent(userId)}&type=eq.nota`
      + `&metadata->>para=eq.${encodeURIComponent(actorId)}`
      + `&metadata->>leida_at=is.null`
      + `&select=id,lead_id,content,created_at,metadata&order=created_at.desc&limit=50`;
    const r = await fetch(q, { headers: sbHeaders() });
    if (!r.ok) return jsonResp({ error: await r.text() }, 500);
    const avisos = (await r.json()) || [];

    // El nombre del lead va aparte: sin él el aviso dice «tienes una nota» y no
    // sobre quién, que es justo lo que hace falta para decidir si abrirla.
    const ids = [...new Set(avisos.map(a => a.lead_id).filter(Boolean))];
    let nombres = {};
    if (ids.length) {
      const rl = await fetch(
        `${SUPABASE_URL}/rest/v1/leads?id=in.(${ids.join(',')})&select=id,name,company`,
        { headers: sbHeaders() }
      );
      if (rl.ok) (await rl.json() || []).forEach(l => { nombres[l.id] = l; });
    }
    return jsonResp({
      avisos: avisos.map(a => ({
        id: a.id,
        lead_id: a.lead_id,
        lead: nombres[a.lead_id]?.name || null,
        empresa: nombres[a.lead_id]?.company || null,
        texto: a.content,
        autor: a.metadata?.actor || null,
        created_at: a.created_at,
      })),
    });
  }

  // PATCH ?avisos=1 — marcar como vistas. PostgREST no sabe fusionar un JSON, así
  // que hay que leer cada metadata y volver a escribirla entera: escribir solo
  // {leida_at} borraría el actor y el destinatario.
  if (req.method === 'PATCH' && url.searchParams.get('avisos') === '1') {
    const q = `${SUPABASE_URL}/rest/v1/lead_activities`
      + `?user_id=eq.${encodeURIComponent(userId)}&type=eq.nota`
      + `&metadata->>para=eq.${encodeURIComponent(actorId)}`
      + `&metadata->>leida_at=is.null`
      + `&select=id,metadata&limit=50`;
    const r = await fetch(q, { headers: sbHeaders() });
    if (!r.ok) return jsonResp({ error: await r.text() }, 500);
    const filas = (await r.json()) || [];
    const ahora = new Date().toISOString();
    let marcadas = 0;
    for (const f of filas) {
      const ok = await fetch(`${SUPABASE_URL}/rest/v1/lead_activities?id=eq.${f.id}`, {
        method: 'PATCH',
        headers: sbHeaders(),
        body: JSON.stringify({ metadata: { ...(f.metadata || {}), leida_at: ahora } }),
      }).then(x => x.ok).catch(() => false);
      if (ok) marcadas++;
    }
    return jsonResp({ marcadas });
  }

  // GET — list activities for a lead
  if (req.method === 'GET') {
    const leadId = url.searchParams.get('lead_id');

    // Sin lead_id: histórico del usuario por rango, para el informe de productividad
    if (!leadId) {
      const from = url.searchParams.get('from');
      let q = `${SUPABASE_URL}/rest/v1/lead_activities?user_id=eq.${userId}&select=id,lead_id,type,created_at,metadata&order=created_at.desc&limit=2000`;
      if (from) q += `&created_at=gte.${encodeURIComponent(from)}`;
      const r = await fetch(q, { headers: sbHeaders() });
      if (!r.ok) return jsonResp({ error: await r.text() }, 500);
      return jsonResp({ activities: (await r.json()) || [] });
    }
    // Verify the lead belongs to this user
    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}&user_id=eq.${userId}&select=id`,
      { headers: sbHeaders() }
    );
    const check = await checkRes.json();
    if (!check?.[0]) return jsonResp({ error: 'No autorizado' }, 403);

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/lead_activities?lead_id=eq.${leadId}&select=*&order=created_at.desc`,
      { headers: sbHeaders() }
    );
    const rows = await res.json();
    return jsonResp({ activities: rows || [] });
  }

  // POST — create activity
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const { lead_id, type, content, metadata, avisar } = body;
    if (!lead_id || !type) return jsonResp({ error: 'Faltan campos requeridos' }, 400);

    const validTypes = ['nota', 'llamada', 'email', 'reunion', 'tarea', 'stage_change', 'creacion'];
    if (!validTypes.includes(type)) return jsonResp({ error: 'Tipo inválido' }, 400);

    // Avisar al responsable es una herramienta de dirección: el dueño y los
    // administradores. Se corta aquí y no solo escondiendo el botón, porque un
    // botón escondido no es un permiso.
    if (avisar && !actorMandaEnLaCuenta) {
      return jsonResp({ error: 'Solo el dueño de la cuenta y los administradores pueden avisar al responsable' }, 403);
    }

    // Verify the lead belongs to this user
    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?id=eq.${lead_id}&user_id=eq.${userId}&select=id,name,company,assigned_to,client_id`,
      { headers: sbHeaders() }
    );
    const check = await checkRes.json();
    const lead = check?.[0];
    if (!lead) return jsonResp({ error: 'No autorizado' }, 403);

    // A quién va dirigida. Uno no se avisa a sí mismo: si el admin lleva el lead,
    // la nota se guarda igual pero sin aviso, y se dice por qué.
    const para = (avisar && lead.assigned_to && lead.assigned_to !== actorId) ? lead.assigned_to : null;

    const payload = {
      lead_id,
      user_id: userId,
      type,
      content: content?.trim() || null,
      // Quién la registró, para que en la ficha no parezcan todas del dueño.
      metadata: {
        ...(metadata || {}),
        ...(actorNombre ? { actor: actorNombre, actor_id: actorId } : {}),
        ...(para ? { para, avisado_at: new Date().toISOString() } : {}),
      },
    };
    const res = await fetch(`${SUPABASE_URL}/rest/v1/lead_activities`, {
      method: 'POST',
      headers: sbHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    const rows = await res.json();

    // ── Una «tarea» tiene que ser una tarea de verdad ────────────────────────
    // El sistema de tareas vive en `activities` (vista Tareas, resumen diario,
    // chip de la tarjeta). Esta tabla es solo el historial. Cuando llega una
    // tarea con fecha y SIN activity_id, se crea también la de verdad.
    //
    // Está en el servidor y no solo en el navegador a propósito: el arreglo
    // anterior era de frontend, y una pestaña abierta desde antes del
    // despliegue seguía creando tareas fantasma sin enterarse. Aquí da igual
    // qué versión tenga cargada quien la crea.
    //
    // Si el navegador ya la creó (manda activity_id), no se hace nada: no se
    // duplica.
    const meta = payload.metadata || {};
    if (type === 'tarea' && meta.due_date && !meta.activity_id) {
      try {
        // La fecha llega como texto local sin zona («2026-09-07T10:30»): es lo
        // único que manda el navegador viejo. Se interpreta en hora de Colombia,
        // que es donde están las cuentas de hoy. Una tarea con una hora a
        // ajustar es infinitamente mejor que una tarea que no existe; cuando
        // haya cuentas en otro huso, el navegador nuevo ya manda la hora exacta
        // y este camino no se usa.
        // OJO: NO basta con mirar si la fecha resultante es inválida. El parser
        // de fechas de V8 es indulgente y rescata algo de casi cualquier texto:
        // new Date('texto basura:00-05:00') devuelve el 1 de enero de 2000, no
        // una fecha inválida. Sin comprobar el formato ANTES, una fecha
        // corrupta habría creado una tarea vencida hace 26 años en la tarjeta
        // del lead. Por eso se valida la forma y luego el rango.
        const txt = String(meta.due_date);
        const conZona = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(txt);
        const sinZona = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(txt);
        const cuando = conZona ? new Date(txt) : sinZona ? new Date(txt + ':00-05:00') : new Date(NaN);
        // Y un rango con sentido: una tarea ni es de 1999 ni de dentro de 20 años.
        const MIN = Date.UTC(2020, 0, 1), MAX = Date.now() + 5 * 365 * 86400000;
        const enRango = !isNaN(cuando) && cuando.getTime() > MIN && cuando.getTime() < MAX;
        if (enRango) {
          const ya = await fetch(
            `${SUPABASE_URL}/rest/v1/activities?lead_id=eq.${lead_id}&type=eq.task` +
            `&due_at=eq.${encodeURIComponent(cuando.toISOString())}&select=id&limit=1`,
            { headers: sbHeaders() }
          ).then(r => (r.ok ? r.json() : [])).catch(() => []);
          if (!ya.length) {
            const creada = await fetch(`${SUPABASE_URL}/rest/v1/activities`, {
              method: 'POST',
              headers: sbHeaders(),
              body: JSON.stringify({
                user_id: userId,
                client_id: lead.client_id || null,
                lead_id,
                type: 'task',
                title: (content || 'Tarea').trim().slice(0, 200),
                due_at: cuando.toISOString(),
                done: false,
              }),
            }).then(r => (r.ok ? r.json() : null)).catch(() => null);
            if (!creada) console.error('[tarea] no se pudo crear la tarea real del lead', lead_id);
          }
        } else {
          console.error('[tarea] fecha ilegible o fuera de rango, no se creó la tarea real:', meta.due_date);
        }
      } catch (e) {
        // Nunca tumba la respuesta: el historial ya está guardado.
        console.error('[tarea] red de seguridad falló:', e?.message);
      }
    }

    // Trabajar el lead ES actividad. Todo lo que mide inactividad —el Pulso, el
    // badge de la tarjeta, el filtro «Sin actividad» y el disparador
    // lead_inactive de las automatizaciones— lee leads.updated_at, que solo se
    // movía al EDITAR la ficha. Registrar una llamada no la editaba, así que el
    // Pulso anunciaba como abandonado un lead atendido el día anterior, y las
    // automatizaciones de reactivación escribían a clientes recién atendidos.
    //
    // stage_change y creacion no están: esas ya vienen con una escritura de la
    // fila, y contarlas aquí sería tocar updated_at dos veces por lo mismo.
    if (['llamada', 'email', 'reunion', 'nota', 'tarea'].includes(type)) {
      const ok = await fetch(
        `${SUPABASE_URL}/rest/v1/leads?id=eq.${lead_id}&user_id=eq.${encodeURIComponent(userId)}`,
        {
          method: 'PATCH',
          headers: sbHeaders(),
          body: JSON.stringify({ updated_at: new Date().toISOString() }),
        }
      ).then(r => r.ok).catch(() => false);
      // La actividad ya está guardada: esto no puede tumbar la respuesta. Pero
      // si falla, el lead seguirá saliendo como inactivo y hay que poder verlo.
      if (!ok) console.error('[actividad] no se pudo refrescar updated_at del lead', lead_id);
    }

    // El correo va DESPUÉS de guardar y nunca tumba la respuesta: la nota es el
    // dato, el correo es el mensajero. Pero se devuelve qué pasó, para que la
    // interfaz no diga «avisado» cuando no salió nada.
    let aviso = null;
    if (avisar) {
      if (!lead.assigned_to) {
        aviso = { enviado: false, motivo: 'este lead no tiene responsable asignado' };
      } else if (!para) {
        aviso = { enviado: false, motivo: 'el lead es tuyo, no hay a quién avisar' };
      } else {
        try {
          const { avisarNotaLead } = await import('./_aviso-lead-nota.js');
          aviso = await avisarNotaLead({
            ownerId: userId,
            autorNombre: actorNombre,
            lead: { id: lead.id, name: lead.name, company: lead.company },
            texto: content || '',
            paraId: para,
          });
        } catch (e) {
          aviso = { enviado: false, motivo: 'no se pudo enviar el correo' };
          console.error('aviso nota lead:', e?.message);
        }
        // Un aviso que no sale deja al comercial sin enterarse y a nadie más
        // mirando: durante seis días el módulo de correo dejó de exportar su
        // función y el único rastro fue un console.error que no lee nadie. Va
        // al registro de errores para que salga en el aviso diario.
        if (!aviso?.enviado) {
          try {
            const { registrarError } = await import('./_registro-errores.js');
            await registrarError({
              origen: 'api',
              donde: 'lead-activities/aviso-nota',
              error: new Error('el aviso al responsable no salió: ' + (aviso?.motivo || 'sin motivo')),
              usuario: userId,
            });
          } catch {}
        }
        // Y al móvil de esa persona. El correo puede tardar en abrirse; una
        // nota de dirección suele querer respuesta hoy, no mañana.
        try {
          const { enviarPushA } = await import('./_push.js');
          await enviarPushA(para, {
            titulo: 'Nota sobre ' + (lead.name || 'un lead'),
            texto: (content || '').slice(0, 120),
            url: '/crm?lead=' + lead.id,
            etiqueta: 'nota-' + lead.id,
          });
        } catch (e) { console.error('[push] nota al responsable:', e?.message); }
      }
    }
    return jsonResp({ activity: rows[0], aviso }, 201);
  }

  // DELETE — delete activity
  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return jsonResp({ error: 'Falta id' }, 400);
    await fetch(
      `${SUPABASE_URL}/rest/v1/lead_activities?id=eq.${id}&user_id=eq.${userId}`,
      { method: 'DELETE', headers: sbHeaders() }
    );
    return jsonResp({ ok: true });
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}

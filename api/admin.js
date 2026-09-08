// api/admin.js
// Consolida: admin-metrics.js + admin-users.js + admin-sync.js
// Rutas:
//   GET  /api/admin?action=metrics
//   GET  /api/admin?action=users
//   GET  /api/admin?action=users&id=X
//   PUT  /api/admin?action=users
//   POST /api/admin?action=sync

const ADMIN_SECRET = process.env.ADMIN_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CLERK_SECRET = process.env.CLERK_SECRET_KEY;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,x-admin-secret,Cache-Control,Pragma',
};

function authCheck(req) {
  return req.headers['x-admin-secret'] === ADMIN_SECRET;
}

async function supabaseReq(path, method = 'GET', body = null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: body ? JSON.stringify(body) : null,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase error: ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function clerkGetUser(id) {
  const res = await fetch(`https://api.clerk.com/v1/users/${id}`, {
    headers: { 'Authorization': `Bearer ${CLERK_SECRET}` }
  });
  return res.json();
}

// Clerk es la fuente de verdad del plan: la app lee publicMetadata.plan del JWT,
// no la tabla users. Si esta escritura falla y nadie lo mira, el panel dice que
// guardó y el usuario se queda con el plan viejo.
async function clerkUpdateMetadata(id, metadata) {
  try {
    const res = await fetch(`https://api.clerk.com/v1/users/${id}/metadata`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${CLERK_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ public_metadata: metadata }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detalle = data?.errors?.[0]?.message || ('HTTP ' + res.status);
      console.error('[admin] Clerk rechazó el cambio de plan:', id, detalle);
      return { ok: false, error: detalle };
    }
    return { ok: true, plan: data?.public_metadata?.plan };
  } catch (e) {
    console.error('[admin] Clerk no respondió:', e.message);
    return { ok: false, error: e.message };
  }
}

// ── METRICS ──────────────────────────────────────────────
async function handleMetrics(req, res) {
  // El MRR de este panel decía $152 y no era ningún ingreso real. Tenía cuatro
  // errores encadenados, y los cuatro venían de contar PLANES en vez de PAGOS:
  //
  //   1. mrr = (individual * 19) + (agency * 19).  'individual' no es un plan
  //      de Acuarius —es un alias viejo que solo tienen cuentas de prueba— y
  //      $19 no es ningún precio: Pro son $39 y Agency $99.
  //   2. Contaba a cualquiera con plan de pago, incluida una cortesía. Alguien
  //      probando gratis figuraba como ingreso.
  //   3. Los trials se buscaban con plan 'free'; el plan se llama 'trial', así
  //      que el contador siempre daba 0.
  //   4. La facturación se filtraba por status 'paid' y en `billing` el estado
  //      es 'active'. Por eso el histórico salía en $0 habiendo filas.
  //
  // Ahora el MRR sale de quien PAGA: plan de pago vigente y origen 'hotmart' o
  // 'externo'. La cortesía vale $0 a propósito.
  const [allUsers, billingAll, logsRecent] = await Promise.all([
    supabaseReq('/users?select=id,email,plan,status,created_at,trial_ends_at,plan_ends_at,plan_origen'),
    supabaseReq('/billing?select=amount,plan,status,created_at,period_end,hotmart_transaction'),
    supabaseReq('/activity_logs?select=action,created_at&order=created_at.desc&limit=200'),
  ]);

  const now = new Date();
  const hace30 = new Date(now - 30 * 86400000);
  const hace7  = new Date(now -  7 * 86400000);
  const en3    = new Date(now.getTime() + 3 * 86400000);

  const PRECIO = { pro: 39, individual: 39, agency: 99, agencia: 99 };
  const esDePago = (p) => Object.prototype.hasOwnProperty.call(PRECIO, p);
  const vigente  = (u) => !u.plan_ends_at || new Date(u.plan_ends_at) > now;
  const paga     = (u) => esDePago(u.plan) && vigente(u) && ['hotmart', 'externo'].includes(u.plan_origen);

  const totalUsers  = allUsers.length;
  const activeUsers = allUsers.filter(u => u.status === 'active').length;
  const suspended   = allUsers.filter(u => u.status === 'suspended').length;
  const newLast30   = allUsers.filter(u => new Date(u.created_at) > hace30).length;
  const newLast7    = allUsers.filter(u => new Date(u.created_at) > hace7).length;

  // Reparto por plan, con TODOS los planes que existen de verdad.
  const porPlan = {};
  for (const u of allUsers) porPlan[u.plan || 'free'] = (porPlan[u.plan || 'free'] || 0) + 1;

  const trialUsers = allUsers.filter(u => u.plan === 'trial').length;
  const trialsExpiringSoon = allUsers.filter(u =>
    u.plan === 'trial' && u.trial_ends_at && new Date(u.trial_ends_at) > now && new Date(u.trial_ends_at) < en3
  ).length;

  // Los que pagan de verdad, y los que tienen plan de pago sin pagar.
  const pagando = allUsers.filter(paga);
  const mrr = pagando.reduce((s, u) => s + (PRECIO[u.plan] || 0), 0);
  const cortesia = allUsers.filter(u => esDePago(u.plan) && vigente(u) && u.plan_origen === 'cortesia');
  const sinRegistrar = allUsers
    .filter(u => esDePago(u.plan) && !u.plan_origen)
    .map(u => ({ email: u.email, plan: u.plan, sin_fecha: !u.plan_ends_at }));
  const vencidosActivos = allUsers.filter(u => esDePago(u.plan) && u.plan_ends_at && new Date(u.plan_ends_at) <= now).length;

  // Facturación real: en `billing` el estado es 'active' | 'cancelled'.
  //
  // Y se descartan las transacciones de prueba. Probar el webhook de Hotmart
  // deja una fila igual que la de una compra de verdad, y las únicas dos que
  // existían el 08-09-2026 eran precisamente eso: TEST-1779886958699 y
  // TEST-E2E-PRO. El panel enseñaba $49 de «histórico» que nadie pagó nunca.
  // Un ingreso inventado es peor que ninguno, porque no se cuestiona.
  const esPrueba = (b) => /^TEST[-_]/i.test(b.hotmart_transaction || '');
  const cobros = billingAll.filter(b => b.status === 'active' && !esPrueba(b));
  const cobrosDePrueba = billingAll.filter(esPrueba).length;
  const totalRevenue = cobros.reduce((s, b) => s + parseFloat(b.amount || 0), 0);
  const revenueThisMonth = cobros
    .filter(b => new Date(b.created_at) > hace30)
    .reduce((s, b) => s + parseFloat(b.amount || 0), 0);

  const messagesLast7 = logsRecent.filter(l => l.action === 'message_sent'    && new Date(l.created_at) > hace7).length;
  const imagesLast7   = logsRecent.filter(l => l.action === 'image_generated' && new Date(l.created_at) > hace7).length;

  return res.json({
    overview: {
      totalUsers, activeUsers, suspended, trialUsers, newLast30, newLast7, trialsExpiringSoon,
      porPlan,
      // se mantienen por compatibilidad con la vista actual del panel
      individualUsers: porPlan.individual || 0,
      agencyUsers: (porPlan.agency || 0) + (porPlan.agencia || 0),
      proUsers: porPlan.pro || 0,
      freeUsers: porPlan.free || 0,
    },
    revenue: {
      mrr,
      clientesPagando: pagando.length,
      totalRevenue: parseFloat(totalRevenue.toFixed(2)),
      revenueThisMonth: parseFloat(revenueThisMonth.toFixed(2)),
    },
    // Lo que hay que mirar: planes de pago que no son ingreso.
    atencion: {
      cortesias: cortesia.length,
      cobros_de_prueba: cobrosDePrueba,
      sin_registrar: sinRegistrar.length,
      sin_registrar_detalle: sinRegistrar.slice(0, 12),
      vencidos_activos: vencidosActivos,
    },
    activity: { messagesLast7, imagesLast7 },
  });
}

// ── USERS ─────────────────────────────────────────────────
async function handleUsers(req, res) {
  // GET ?action=users&id=X → detalle
  if (req.method === 'GET' && req.query.id) {
    const [clerkUser, dbRows] = await Promise.all([
      clerkGetUser(req.query.id),
      supabaseReq(`/users?id=eq.${req.query.id}&select=*`),
    ]);
    const logs    = await supabaseReq(`/activity_logs?user_id=eq.${req.query.id}&order=created_at.desc&limit=50`);
    const billing = await supabaseReq(`/billing?user_id=eq.${req.query.id}&order=created_at.desc`);
    return res.json({ user: dbRows?.[0] || null, clerk: clerkUser, logs: logs || [], billing: billing || [] });
  }

  // GET ?action=users → listar
  if (req.method === 'GET') {
    const { plan, status, page = 1 } = req.query;
    const limit = 20;
    const offset = (page - 1) * limit;
    let query = `/users?select=*&order=created_at.desc&limit=${limit}&offset=${offset}`;
    if (plan   && plan   !== 'all') query += `&plan=eq.${plan}`;
    if (status && status !== 'all') query += `&status=eq.${status}`;

    let countQuery = `/users?select=id`;
    if (plan   && plan   !== 'all') countQuery += `&plan=eq.${plan}`;
    if (status && status !== 'all') countQuery += `&status=eq.${status}`;

    const [users, countRes] = await Promise.all([supabaseReq(query), supabaseReq(countQuery)]);
    return res.json({
      users: users || [],
      total: countRes?.length || 0,
      page: parseInt(page),
      pages: Math.ceil((countRes?.length || 0) / limit),
    });
  }

  // PUT ?action=users → actualizar
  if (req.method === 'PUT') {
    const { id, plan, status, messages_limit, accounts_limit, agency_extra_accounts, notes } = req.body;
    if (!id) return res.status(400).json({ error: 'id requerido' });

    const updates = {};
    if (plan                  !== undefined) updates.plan                  = plan;
    if (status                !== undefined) updates.status                = status;
    if (messages_limit        !== undefined) updates.messages_limit        = messages_limit;
    if (accounts_limit        !== undefined) updates.accounts_limit        = accounts_limit;
    if (agency_extra_accounts !== undefined) updates.agency_extra_accounts = agency_extra_accounts;

    const dbResult = await supabaseReq(`/users?id=eq.${id}`, 'PATCH', updates);

    let clerk = null;
    if (plan !== undefined) {
      clerk = await clerkUpdateMetadata(id, { plan, status: status || 'active' });
      // Sin Clerk el cambio NO surte efecto: mejor un error visible que un
      // "guardado" que engaña. La fila de Supabase ya quedó escrita.
      if (!clerk.ok) {
        return res.status(502).json({
          error: 'El plan no se pudo aplicar en Clerk (' + clerk.error + '). El usuario sigue con su plan anterior.',
          supabase_ok: true, clerk_ok: false,
        });
      }
    }

    await supabaseReq('/activity_logs', 'POST', {
      user_id: id, action: 'admin_update', details: { changes: updates, notes: notes || '' },
    });
    return res.json({ success: true, user: dbResult?.[0] || null, clerk_ok: clerk ? true : null, plan_aplicado: clerk?.plan });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// ── CREATE TEST USER ──────────────────────────────────────
async function handleCreateTestUser(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { email, name, password, plan, status, trial_days, messages_limit, accounts_limit, notes } = req.body;
  if (!email) return res.status(400).json({ error: 'email requerido' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

  // 1. Crear usuario en Clerk con email + contraseña
  const firstName = name ? name.split(' ')[0] : 'Test';
  const lastName  = name ? name.split(' ').slice(1).join(' ') : 'User';

  const clerkRes = await fetch('https://api.clerk.com/v1/users', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CLERK_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email_address: [email],
      password,
      first_name: firstName,
      last_name: lastName,
      public_metadata: { plan: plan || 'free', status: status || 'active', is_test_user: true },
      skip_password_checks: true,
    }),
  });

  const clerkData = await clerkRes.json();
  if (!clerkRes.ok) {
    const detail = clerkData.errors?.[0]?.message || JSON.stringify(clerkData);
    return res.status(400).json({ error: 'Error al crear en Clerk: ' + detail });
  }

  const clerkId = clerkData.id; // ID real de Clerk, ej: user_2abc...

  // 2. Verificar el email automáticamente (sin esto Clerk bloquea el login)
  const emailId = clerkData.email_addresses?.[0]?.id;
  if (emailId) {
    await fetch(`https://api.clerk.com/v1/email_addresses/${emailId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${CLERK_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ verified: true }),
    });
  }

  // 3. Insertar en Supabase con el ID real de Clerk
  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + (parseInt(trial_days) || 7));

  const userData = {
    id: clerkId,
    email,
    name: name || 'Usuario de prueba',
    plan: plan || 'free',
    status: status || 'active',
    trial_ends_at: trialEndsAt.toISOString(),
    messages_limit: parseInt(messages_limit) || 99999,
    accounts_limit: parseInt(accounts_limit) || 1,
    messages_used: 0,
    connected_accounts: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const result = await supabaseReq('/users', 'POST', userData);

  // 4. Log
  await supabaseReq('/activity_logs', 'POST', {
    user_id: clerkId,
    action: 'admin_create_test',
    details: { notes: notes || 'Usuario de prueba creado desde admin', plan, created_by: 'admin' },
  });

  return res.json({
    success: true,
    user: result?.[0] || userData,
    id: clerkId,
    clerk_id: clerkId,
    login_url: 'https://app.acuarius.app',
  });
}

// ── RESET TEST USER PASSWORD ─────────────────────────────
async function handleResetTestPassword(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { id, password } = req.body;
  if (!id || !password) return res.status(400).json({ error: 'id y password requeridos' });
  if (password.length < 8) return res.status(400).json({ error: 'Mínimo 8 caracteres' });

  if (id.startsWith('test_')) {
    return res.status(400).json({ error: 'Este usuario fue creado con el sistema anterior (sin Clerk). Elimínalo y crea uno nuevo con el formulario actual.' });
  }

  const r = await fetch(`https://api.clerk.com/v1/users/${id}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${CLERK_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      password,
      skip_password_checks: true,
    }),
  });

  const data = await r.json();
  if (!r.ok) {
    const detail = data.errors?.[0]?.message || JSON.stringify(data);
    return res.status(400).json({ error: 'Error Clerk: ' + detail });
  }

  return res.json({ success: true, id });
}

// ── DELETE TEST USER ─────────────────────────────────────
async function handleDeleteTestUser(req, res) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'DELETE only' });

  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id requerido' });

  // IDs con prefijo test_ son usuarios legacy sin Clerk — solo borrar de Supabase
  if (id.startsWith('test_')) {
    await supabaseReq(`/activity_logs?user_id=eq.${id}`, 'DELETE');
    await supabaseReq(`/users?id=eq.${id}`, 'DELETE');
    return res.json({ success: true, id, note: 'legacy test user removed from Supabase only' });
  }

  // Usuarios reales: verificar que sea test en Clerk antes de borrar
  let clerkUser;
  try { clerkUser = await clerkGetUser(id); } catch(e) { clerkUser = null; }

  if (clerkUser && !clerkUser?.public_metadata?.is_test_user) {
    return res.status(400).json({ error: 'Solo se pueden eliminar usuarios marcados como is_test_user' });
  }

  // 1. Eliminar logs (FK constraint)
  await supabaseReq(`/activity_logs?user_id=eq.${id}`, 'DELETE');
  // 2. Eliminar de Supabase
  await supabaseReq(`/users?id=eq.${id}`, 'DELETE');
  // 3. Eliminar de Clerk (si existe)
  if (clerkUser?.id) {
    await fetch(`https://api.clerk.com/v1/users/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${CLERK_SECRET}` },
    });
  }

  return res.json({ success: true, id });
}

// ── SYNC ──────────────────────────────────────────────────
async function handleSync(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let allClerkUsers = [];
  let offset = 0;
  let clerkDebug = null;

  while (true) {
    const r = await fetch(`https://api.clerk.com/v1/users?limit=100&offset=${offset}&order_by=-created_at`, {
      headers: { 'Authorization': `Bearer ${CLERK_SECRET}` }
    });
    const data = await r.json();
    clerkDebug = { status: r.status, keys: Object.keys(data), hasData: !!data.data, isArray: Array.isArray(data) };
    if (!r.ok) return res.status(500).json({ error: 'Clerk API error', status: r.status, detail: data });
    const users = Array.isArray(data) ? data : (data.data || []);
    if (!users.length) break;
    allClerkUsers = allClerkUsers.concat(users);
    if (users.length < 100) break;
    offset += 100;
  }

  let synced = 0;
  for (const u of allClerkUsers) {
    const email  = u.email_addresses?.[0]?.email_address || '';
    const name   = `${u.first_name || ''} ${u.last_name || ''}`.trim();
    const plan   = u.public_metadata?.plan   || 'free';
    const status = u.public_metadata?.status || 'active';
    // Se arrastran también la fecha y el origen: si el espejo se desvía por
    // cualquier vía (Hotmart, un cambio a mano en Clerk), el sync lo corrige.
    const hasta  = u.public_metadata?.hasta  || null;
    const origen = u.public_metadata?.origen || null;
    const prueba = u.public_metadata?.trial_until || null;

    await fetch(`${SUPABASE_URL}/rest/v1/users`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        id: u.id, email, name, plan, status, plan_ends_at: hasta, plan_origen: origen,
        trial_ends_at: prueba,
        created_at: new Date(u.created_at).toISOString(),
        updated_at: new Date(u.updated_at).toISOString(),
      }),
    });
    synced++;
  }

  return res.json({ success: true, synced, total: allClerkUsers.length, clerkDebug });
}

// ── PLAN CON FECHA ────────────────────────────────────────
// Da o renueva un plan dejando SIEMPRE constancia de hasta cuándo vale y por
// qué lo tiene. Nació de encontrar seis cuentas con 'pro' puesto a mano que no
// caducaba nadie: el cron solo miraba los planes 'trial'.
//
//   origen 'externo'  → el cliente pagó por fuera (transferencia, Nequi…).
//                       Deja fila en `billing`, para que el pago exista en el
//                       sistema y no solo en la memoria de alguien.
//   origen 'cortesia' → acceso regalado para probar. NO deja fila de pago:
//                       no lo es, y contarlo como ingreso falsearía las cuentas.
//   origen 'hotmart'  → lo pone el webhook; aquí se acepta por si hay que
//                       reponer un cobro que no llegó.
//
// Clerk manda: la app lee el plan del JWT, no de la tabla users. Si Clerk falla,
// esto devuelve error y NO escribe el pago — un pago registrado con el plan sin
// aplicar es peor que no haber hecho nada.
async function handleSetPlan(req, res) {
  const { userId, plan, meses, dias, monto, nota } = req.body || {};
  const PLANES  = ['free', 'pro', 'agency', 'trial'];
  const ORIGENES = ['externo', 'cortesia', 'hotmart'];

  // Una prueba nunca es un ingreso, así que su concepto no se pregunta: es
  // cortesía siempre. Dejarlo elegir permitiría dar de alta un 'trial' que
  // luego apareciera en el MRR.
  const esPrueba = plan === 'trial';
  const origen = esPrueba ? 'cortesia' : (req.body || {}).origen;

  if (!userId)                     return res.status(400).json({ error: 'Falta userId' });
  if (!PLANES.includes(plan))      return res.status(400).json({ error: 'Plan inválido. Usa: ' + PLANES.join(', ') });
  if (plan !== 'free' && !ORIGENES.includes(origen)) {
    return res.status(400).json({ error: 'Falta el origen. Usa: ' + ORIGENES.join(', ') });
  }

  // La prueba se mide en días —14 es lo que da el alta automática— y el resto
  // en meses. Pedir «meses» para una prueba obligaba a regalar un mes entero.
  const d = esPrueba ? parseInt(dias, 10) : 0;
  const n = (esPrueba || plan === 'free') ? 0 : parseInt(meses, 10);
  if (esPrueba && (!Number.isFinite(d) || d < 1 || d > 90)) {
    return res.status(400).json({ error: 'Los días deben ser un número entre 1 y 90' });
  }
  if (!esPrueba && plan !== 'free' && (!Number.isFinite(n) || n < 1 || n > 24)) {
    return res.status(400).json({ error: 'Los meses deben ser un número entre 1 y 24' });
  }

  // Si ya tiene una fecha por delante, se SUMA: renovar a alguien al día no
  // puede recortarle lo que le queda.
  //
  // Cada cosa suma sobre LA SUYA: una prueba se alarga desde `trial_until` y un
  // plan de pago desde `hasta`. Mezclarlas tenía una trampa fea: dar «14 días
  // de prueba» a alguien con Pro pagado hasta diciembre lo dejaba en plan
  // 'trial' hasta diciembre + 14, es decir, le quitaba el plan que pagó y le
  // regalaba dos semanas encima.
  let desde = new Date();
  try {
    const r = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
      headers: { Authorization: 'Bearer ' + CLERK_SECRET, 'User-Agent': 'acuarius-admin' },
    });
    const actual = await r.json();
    const campo = esPrueba ? 'trial_until' : 'hasta';
    const f = actual?.public_metadata?.[campo] ? new Date(actual.public_metadata[campo]) : null;
    if (f && !isNaN(f) && f > desde) desde = f;
  } catch (e) {
    console.error('[admin] no se pudo leer el plan actual de', userId, e.message);
  }
  const hasta = new Date(desde);
  if (esPrueba) hasta.setDate(hasta.getDate() + d);
  else hasta.setMonth(hasta.getMonth() + n);

  // `trial_until` es el campo que de verdad mueve una prueba: lo lee el
  // contador de la app (app.js) y la rama de pruebas del cron. Sin él, un
  // 'trial' puesto a mano no caducaba y no se veía en ningún lado.
  // `trial_used` se marca para que además no pueda arrancar otra por su cuenta.
  const meta = plan === 'free'
    ? { plan: 'free', status: 'active', hasta: null, origen: null, trial_until: null, aviso_fin: null }
    : esPrueba
      // La prueba NO escribe `hasta`: esa fecha es de los planes de pago. Al
      // escribir las dos, cobrarle después un mes a quien tenía 60 días de
      // prueba se los sumaba encima — Pro hasta diciembre en vez de octubre.
      ? { plan: 'trial', status: 'active', hasta: null,
          trial_until: hasta.toISOString(), trial_used: true, origen, aviso_fin: null }
      : { plan, status: 'active', hasta: hasta.toISOString().slice(0, 10),
          trial_until: null, origen, aviso_fin: null };

  const r = await clerkUpdateMetadata(userId, meta);
  if (!r.ok) return res.status(502).json({ error: 'Clerk rechazó el cambio: ' + r.error });

  // Espejo en la tabla `users`, SOLO para diagnóstico: la verdad sigue siendo
  // Clerk. Existe para que tools/soporte.mjs pueda avisar de un plan sin fecha
  // sin necesitar credenciales de Clerk. Si falla, no se aborta nada.
  await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      plan: meta.plan,
      plan_ends_at: meta.hasta,
      plan_origen: meta.origen,
      trial_ends_at: meta.trial_until,
    }),
  }).catch((e) => console.error('[admin] espejo de users no actualizado:', e.message));

  // El pago, solo si de verdad lo hubo.
  let pagoRegistrado = false;
  if (plan !== 'free' && origen !== 'cortesia') {
    const importe = Number(monto) || (plan === 'agency' ? 99 : 39) * n;
    const ok = await fetch(`${SUPABASE_URL}/rest/v1/billing`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        user_id: userId, amount: importe, currency: 'USD', plan,
        period_start: new Date().toISOString(),
        period_end: hasta.toISOString(),
        status: 'active',
        notes: (origen === 'externo' ? 'Pago externo confirmado en el panel' : 'Registrado en el panel')
               + (nota ? ' — ' + String(nota).slice(0, 200) : ''),
      }),
    }).then(x => x.ok).catch(() => false);
    pagoRegistrado = ok;
    // El plan YA está aplicado: que falle el registro no se le puede ocultar a
    // quien lo hizo, porque el pago quedaría sin rastro.
    if (!ok) console.error('[admin] plan aplicado pero NO se pudo registrar el pago de', userId);
  }

  return res.json({
    ok: true,
    plan,
    // `hasta` sale con la fecha que aplique, sea de pago o de prueba, para que
    // quien llame no tenga que saber en qué campo vive cada una.
    hasta: meta.hasta || (meta.trial_until ? meta.trial_until.slice(0, 10) : null),
    trial_until: meta.trial_until || null,
    origen: meta.origen,
    pago_registrado: pagoRegistrado,
    aviso: (plan !== 'free' && origen !== 'cortesia' && !pagoRegistrado)
      ? 'El plan quedó aplicado, pero el pago NO se pudo registrar. Anótalo aparte.'
      : null,
  });
}

// ── RECOMMENDATIONS ───────────────────────────────────────
/*
SQL para Supabase (ejecutar una vez):
CREATE TABLE recommendations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  agent TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'dismissed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_recommendations_user_id ON recommendations(user_id);
CREATE INDEX idx_recommendations_agent ON recommendations(agent);
*/
async function handleSaveRecommendation(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { userId, agent, content } = req.body || {};
  if (!userId || !agent || !content) return res.status(400).json({ error: 'userId, agent, content requeridos' });
  const result = await supabaseReq('/recommendations', 'POST', { user_id: userId, agent, content });
  return res.json({ id: result?.[0]?.id, created_at: result?.[0]?.created_at });
}

async function handleGetRecommendations(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const { userId, agent } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId requerido' });
  let query = `/recommendations?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=50&select=id,agent,content,status,created_at`;
  if (agent) query += `&agent=eq.${encodeURIComponent(agent)}`;
  const result = await supabaseReq(query);
  return res.json(result || []);
}

async function handleUpdateRecommendation(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'PATCH only' });
  const { id, status } = req.body || {};
  if (!id || !status) return res.status(400).json({ error: 'id y status requeridos' });
  await supabaseReq(`/recommendations?id=eq.${id}`, 'PATCH', { status, updated_at: new Date().toISOString() });
  return res.json({ ok: true });
}

// ── PERFORMANCE SNAPSHOTS ────────────────────────────────
/*
SQL para Supabase (ejecutar una vez):
CREATE TABLE performance_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  agent TEXT NOT NULL,
  period_label TEXT NOT NULL,
  period_type TEXT NOT NULL,
  metrics JSONB NOT NULL,
  analysis TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_snapshots_user_agent ON performance_snapshots(user_id, agent);
*/
async function handleSaveSnapshot(req, res) {
  if (req.method !== 'POST' && req.method !== 'PATCH') return res.status(405).json({ error: 'POST/PATCH only' });
  if (req.method === 'PATCH') {
    const { id, analysis } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id requerido' });
    await supabaseReq(`/performance_snapshots?id=eq.${id}`, 'PATCH', { analysis });
    return res.json({ ok: true });
  }
  const { userId, agent, period_label, period_type, metrics, analysis } = req.body || {};
  if (!userId || !agent || !period_label || !period_type || !metrics) return res.status(400).json({ error: 'Campos requeridos faltantes' });
  const result = await supabaseReq('/performance_snapshots', 'POST', { user_id: userId, agent, period_label, period_type, metrics, analysis: analysis || null });
  return res.json({ id: result?.[0]?.id });
}

async function handleGetSnapshots(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const { userId, agent, limit = 10 } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId requerido' });
  let query = `/performance_snapshots?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=${limit}`;
  if (agent) query += `&agent=eq.${encodeURIComponent(agent)}`;
  const result = await supabaseReq(query);
  return res.json(result || []);
}

// ── PLATFORM CONNECTIONS ─────────────────────────────────
/*
SQL para Supabase (ejecutar una vez):
CREATE TABLE platform_connections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('google_ads', 'meta_ads', 'tiktok_ads', 'linkedin_ads')),
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  account_id TEXT,
  account_name TEXT,
  extra_data JSONB DEFAULT '{}',
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, platform)
);
CREATE INDEX idx_connections_user ON platform_connections(user_id);

CREATE TABLE campaign_alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  account_id TEXT NOT NULL,
  campaign_id TEXT,
  campaign_name TEXT,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  message TEXT NOT NULL,
  metric_value NUMERIC,
  threshold_value NUMERIC,
  is_read BOOLEAN DEFAULT FALSE,
  is_dismissed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_alerts_user_unread ON campaign_alerts(user_id, is_read, is_dismissed);

*/

async function handleGetConnection(req, res) {
  const { userId, platform } = req.query;
  if (!userId || !platform) return res.status(400).json({ error: 'userId y platform requeridos' });
  let rows;
  try {
    rows = await supabaseReq(
      `/platform_connections?user_id=eq.${encodeURIComponent(userId)}&platform=eq.${platform}&select=platform,access_token,account_id,account_name,token_expires_at,connected_at,extra_data`
    );
  } catch (err) {
    console.error('handleGetConnection Supabase error:', err.message);
    return res.json({ connected: false });
  }
  if (!rows?.length) return res.json({ connected: false });
  const c = rows[0];
  return res.json({
    connected:       true,
    access_token:    c.access_token,
    account_id:      c.account_id,
    account_name:    c.account_name,
    token_expires_at: c.token_expires_at,
    connected_at:    c.connected_at,
    extra_data:      c.extra_data || {},
  });
}

async function handleDisconnectPlatform(req, res) {
  if (req.method !== 'POST' && req.method !== 'DELETE') return res.status(405).json({ error: 'POST/DELETE only' });
  const { userId, platform } = req.body || {};
  if (!userId || !platform) return res.status(400).json({ error: 'userId y platform requeridos' });
  await supabaseReq(`/platform_connections?user_id=eq.${encodeURIComponent(userId)}&platform=eq.${encodeURIComponent(platform)}`, 'DELETE');
  return res.json({ ok: true });
}

// ── ALERTAS ───────────────────────────────────────────────

async function handleCheckAlerts(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId requerido' });

  const connections = await supabaseReq(
    `/platform_connections?user_id=eq.${encodeURIComponent(userId)}&select=platform,access_token,account_id`
  ).catch(() => []);

  const newAlerts = [];
  const today = new Date().toISOString().split('T')[0];

  for (const conn of connections || []) {
    if (!conn.access_token) continue;
    try {
      if (conn.platform === 'google_ads' && conn.account_id) {
        const gRes = await fetch(
          `${SUPABASE_URL ? '' : 'https://app.acuarius.app'}/api/google-ads?action=get-campaigns&userId=${encodeURIComponent(userId)}&customerId=${conn.account_id.replace(/-/g, '')}&dateRange=LAST_7_DAYS`,
          { headers: { 'Content-Type': 'application/json' } }
        );
        const gData = await gRes.json().catch(() => ({}));
        const campaigns = gData.campaigns || [];

        for (const c of campaigns) {
          if (c.status !== 'ENABLED') continue;
          // zero_conversions: gasto > $20 y 0 conversiones → critical si > $50
          if (parseFloat(c.cost) > 20 && parseFloat(c.conversions) === 0) {
            const exists = await supabaseReq(
              `/campaign_alerts?user_id=eq.${encodeURIComponent(userId)}&campaign_id=eq.${c.id}&alert_type=eq.zero_conversions&created_at=gte.${today}T00:00:00Z`
            );
            if (!exists?.length) {
              const isCritical = parseFloat(c.cost) > 50;
              const alert = {
                user_id: userId, platform: 'google_ads', account_id: conn.account_id,
                campaign_id: String(c.id), campaign_name: c.name,
                alert_type: 'zero_conversions', severity: isCritical ? 'critical' : 'warning',
                message: `Campaña "${c.name}" tiene $${c.cost} gastado en 7 días y 0 conversiones.`,
                metric_value: 0, threshold_value: 1,
              };
              await supabaseReq('/campaign_alerts', 'POST', alert);
              newAlerts.push(alert);
            }
          }
          // ctr_drop: CTR < 0.5% → critical si < 0.3% con > 5000 impresiones
          if (parseFloat(c.ctr) < 0.5 && parseInt(c.impressions) > 1000) {
            const exists = await supabaseReq(
              `/campaign_alerts?user_id=eq.${encodeURIComponent(userId)}&campaign_id=eq.${c.id}&alert_type=eq.ctr_drop&created_at=gte.${today}T00:00:00Z`
            );
            if (!exists?.length) {
              const isCritical = parseFloat(c.ctr) < 0.3 && parseInt(c.impressions) > 5000;
              const alert = {
                user_id: userId, platform: 'google_ads', account_id: conn.account_id,
                campaign_id: String(c.id), campaign_name: c.name,
                alert_type: 'ctr_drop', severity: isCritical ? 'critical' : 'warning',
                message: `CTR bajo en "${c.name}": ${c.ctr}% (benchmark mínimo 0.5%).`,
                metric_value: parseFloat(c.ctr), threshold_value: 0.5,
              };
              await supabaseReq('/campaign_alerts', 'POST', alert);
              newAlerts.push(alert);
            }
          }
        }
      }

      if (conn.platform === 'meta_ads' && conn.account_id) {
        const mRes = await fetch(
          `${SUPABASE_URL ? '' : 'https://app.acuarius.app'}/api/meta-ads?action=get-campaigns&userId=${encodeURIComponent(userId)}&adAccountId=${conn.account_id}&datePreset=last_7d`
        );
        const mData = await mRes.json().catch(() => ({}));
        const campaigns = mData.campaigns || [];

        for (const c of campaigns) {
          if (c.status !== 'ACTIVE') continue;
          // high_frequency: > 3.5 → critical si > 5
          if (parseFloat(c.frequency) > 3.5) {
            const exists = await supabaseReq(
              `/campaign_alerts?user_id=eq.${encodeURIComponent(userId)}&campaign_id=eq.${c.id}&alert_type=eq.high_frequency&created_at=gte.${today}T00:00:00Z`
            );
            if (!exists?.length) {
              const isCritical = parseFloat(c.frequency) > 5;
              const alert = {
                user_id: userId, platform: 'meta_ads', account_id: conn.account_id,
                campaign_id: c.id, campaign_name: c.name,
                alert_type: 'high_frequency', severity: isCritical ? 'critical' : 'warning',
                message: `Frecuencia alta en "${c.name}": ${c.frequency} (límite recomendado: 3.5). Audiencia posiblemente saturada.`,
                metric_value: parseFloat(c.frequency), threshold_value: 3.5,
              };
              await supabaseReq('/campaign_alerts', 'POST', alert);
              newAlerts.push(alert);
            }
          }
          // zero_conversions Meta → critical si gasto > $50
          if (parseFloat(c.spend) > 20 && c.conversions === 0) {
            const exists = await supabaseReq(
              `/campaign_alerts?user_id=eq.${encodeURIComponent(userId)}&campaign_id=eq.${c.id}&alert_type=eq.zero_conversions&created_at=gte.${today}T00:00:00Z`
            );
            if (!exists?.length) {
              const isCritical = parseFloat(c.spend) > 50;
              const alert = {
                user_id: userId, platform: 'meta_ads', account_id: conn.account_id,
                campaign_id: c.id, campaign_name: c.name,
                alert_type: 'zero_conversions', severity: isCritical ? 'critical' : 'warning',
                message: `"${c.name}" tiene $${c.spend} gastado y 0 conversiones en 7 días.`,
                metric_value: 0, threshold_value: 1,
              };
              await supabaseReq('/campaign_alerts', 'POST', alert);
              newAlerts.push(alert);
            }
          }
          // high_cpa: CPA > 3x el presupuesto diario → critical
          if (parseFloat(c.cpa) > 0 && c.dailyBudget && parseFloat(c.cpa) > parseFloat(c.dailyBudget) * 3) {
            const exists = await supabaseReq(
              `/campaign_alerts?user_id=eq.${encodeURIComponent(userId)}&campaign_id=eq.${c.id}&alert_type=eq.high_cpa&created_at=gte.${today}T00:00:00Z`
            );
            if (!exists?.length) {
              const alert = {
                user_id: userId, platform: 'meta_ads', account_id: conn.account_id,
                campaign_id: c.id, campaign_name: c.name,
                alert_type: 'high_cpa', severity: 'critical',
                message: `CPA muy alto en "${c.name}": $${c.cpa} (${Math.round(parseFloat(c.cpa)/parseFloat(c.dailyBudget))}x el presupuesto diario).`,
                metric_value: parseFloat(c.cpa), threshold_value: parseFloat(c.dailyBudget) * 3,
              };
              await supabaseReq('/campaign_alerts', 'POST', alert);
              newAlerts.push(alert);
            }
          }
        }
      }
    } catch (e) {
      console.error(`check-alerts error for ${conn.platform}:`, e.message);
    }
  }

  return res.json({ alerts: newAlerts, count: newAlerts.length });
}

async function handleGetAlerts(req, res) {
  const { userId, platform, unreadOnly } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId requerido' });
  let query = `/campaign_alerts?user_id=eq.${encodeURIComponent(userId)}&is_dismissed=eq.false&order=created_at.desc&limit=50`;
  if (platform && platform !== 'all') query += `&platform=eq.${encodeURIComponent(platform)}`;
  if (unreadOnly === 'true') query += `&is_read=eq.false`;
  const alerts = await supabaseReq(query);
  return res.json(alerts || []);
}

async function handleMarkAlertsRead(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId requerido' });
  await supabaseReq(`/campaign_alerts?user_id=eq.${encodeURIComponent(userId)}&is_read=eq.false`, 'PATCH', { is_read: true });
  return res.json({ ok: true });
}

async function handleDismissAlert(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id requerido' });
  await supabaseReq(`/campaign_alerts?id=eq.${id}`, 'PATCH', { is_dismissed: true });
  return res.json({ ok: true });
}

// ── META TOKEN REFRESH ────────────────────────────────────

async function handleRefreshMetaToken(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId requerido' });

  const rows = await supabaseReq(
    `/platform_connections?user_id=eq.${encodeURIComponent(userId)}&platform=eq.meta_ads&select=access_token,token_expires_at`
  );
  if (!rows?.length || !rows[0].access_token) return res.status(404).json({ error: 'No hay token de Meta para este usuario' });

  const conn = rows[0];
  const expiresAt = new Date(conn.token_expires_at);
  const daysLeft = (expiresAt - Date.now()) / (1000 * 60 * 60 * 24);

  if (daysLeft > 7) return res.json({ ok: true, refreshed: false, daysLeft: Math.round(daysLeft) });

  const refreshRes = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token?` +
    new URLSearchParams({
      grant_type:        'fb_exchange_token',
      client_id:         process.env.META_APP_ID,
      client_secret:     process.env.META_APP_SECRET,
      fb_exchange_token: conn.access_token,
    })
  );
  const data = await refreshRes.json();
  if (data.error || !data.access_token) return res.status(400).json({ error: 'No se pudo renovar el token de Meta' });

  const newExpires = new Date(Date.now() + (data.expires_in || 5184000) * 1000).toISOString();
  await supabaseReq(
    `/platform_connections?user_id=eq.${encodeURIComponent(userId)}&platform=eq.meta_ads`,
    'PATCH',
    { access_token: data.access_token, token_expires_at: newExpires, updated_at: new Date().toISOString() }
  );

  return res.json({ ok: true, refreshed: true, daysLeft: Math.round((data.expires_in || 5184000) / 86400) });
}

// ── API ACTION LOGS ───────────────────────────────────────
/*
SQL para Supabase (ejecutar una vez):
CREATE TABLE api_action_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  action_type TEXT NOT NULL,
  entity_id TEXT,
  entity_name TEXT,
  old_value JSONB,
  new_value JSONB,
  confirmed BOOLEAN NOT NULL,
  executed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_action_logs_user ON api_action_logs(user_id, executed_at DESC);
*/

async function handleLogApiAction(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { userId, platform, actionType, entityId, entityName, oldValue, newValue, confirmed } = req.body || {};
  if (!userId || !platform || !actionType || confirmed === undefined) {
    return res.status(400).json({ error: 'userId, platform, actionType, confirmed requeridos' });
  }
  const result = await supabaseReq('/api_action_logs', 'POST', {
    user_id: userId, platform, action_type: actionType,
    entity_id: entityId || null, entity_name: entityName || null,
    old_value: oldValue || null, new_value: newValue || null,
    confirmed: !!confirmed,
  });
  return res.json({ id: result?.[0]?.id, ok: true });
}

// ── SAVE CONNECTION (upsert con on_conflict) ──────────────
// Red de seguridad del OAuth callback y reparación de conexiones legacy.
// Devuelve el error de Supabase si falla — nada de fallos silenciosos.
async function handleSaveConnection(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { userId, platform, access_token, refresh_token, account_name, expires_in } = req.body || {};
  if (!userId || !platform || !access_token) return res.status(400).json({ error: 'userId, platform y access_token requeridos' });
  if (!['google_ads', 'meta_ads', 'linkedin_ads'].includes(platform)) return res.status(400).json({ error: 'platform inválida' });
  const expiresAt = new Date(Date.now() + (parseInt(expires_in) || 3600) * 1000).toISOString();
  const payload = {
    user_id:          userId,
    platform,
    access_token,
    ...(refresh_token ? { refresh_token } : {}),
    token_expires_at: expiresAt,
    ...(account_name ? { account_name } : {}),
    updated_at:       new Date().toISOString(),
  };
  const r = await fetch(`${SUPABASE_URL}/rest/v1/platform_connections?on_conflict=user_id,platform`, {
    method: 'POST',
    headers: {
      'apikey':        SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    console.error('handleSaveConnection error:', r.status, errText.slice(0, 300));
    return res.status(500).json({ error: 'Supabase rechazó el guardado', detail: errText.slice(0, 300), status: r.status });
  }
  return res.json({ ok: true });
}

// ── ASSIGN CONNECTION TO CLIENT ───────────────────────────

async function handleAssignConnection(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'PATCH only' });
  const { connectionId, clientId, label } = req.body || {};
  if (!connectionId) return res.status(400).json({ error: 'connectionId requerido' });
  const updates = {};
  if (clientId !== undefined) updates.client_id = clientId;
  if (label    !== undefined) updates.label = label;
  await supabaseReq(`/platform_connections?id=eq.${encodeURIComponent(connectionId)}`, 'PATCH', updates);
  return res.json({ ok: true });
}

// ── COMPETITIVE SEARCH ────────────────────────────────────

const BRAVE_API_KEY = process.env.BRAVE_SEARCH_API_KEY;

async function braveSearch(query, count = 10) {
  if (!BRAVE_API_KEY) throw new Error('BRAVE_SEARCH_API_KEY no configurada');
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&country=co&search_lang=es`;
  const res = await fetch(url, {
    headers: { 'X-Subscription-Token': BRAVE_API_KEY, 'Accept': 'application/json' }
  });
  if (!res.ok) throw new Error(`Brave API error: ${res.status}`);
  return res.json();
}

async function handleCompetitiveSearch(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { query, type = 'serp' } = req.body || {};
  if (!query) return res.status(400).json({ error: 'query requerido' });

  try {
    let searchQuery = query;
    if (type === 'ads') searchQuery = `${query} precio comprar`;
    if (type === 'keywords') searchQuery = `${query} Colombia precio comprar vs`;

    const data = await braveSearch(searchQuery);
    const webResults = data.web?.results || [];

    const results = webResults.map(r => ({
      title:       r.title,
      url:         r.url,
      description: r.description,
      isAd:        r.url?.includes('gad_source') || r.url?.includes('gclid') || false,
    }));

    return res.json({ results, query: searchQuery, type, total: results.length });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ── UPDATE USER PREFERENCES ───────────────────────────────

async function handleUpdatePreferences(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { userId, email_reports } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId requerido' });
  await supabaseReq(`/users?id=eq.${encodeURIComponent(userId)}`, 'PATCH', {
    email_reports: !!email_reports,
    updated_at: new Date().toISOString(),
  });
  return res.json({ ok: true });
}

// ── SAVE PLATFORM ACCOUNT ID ──────────────────────────────
// Llamado cuando el usuario selecciona una cuenta publicitaria (ej: Meta ad account)
// Guarda el account_id en Supabase para que los crons de alertas/reportes lo usen

async function handleSavePlatformAccount(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { userId, platform, accountId, accountName } = req.body || {};
  if (!userId || !platform || !accountId) {
    return res.status(400).json({ error: 'userId, platform, accountId requeridos' });
  }
  await supabaseReq(
    `/platform_connections?user_id=eq.${encodeURIComponent(userId)}&platform=eq.${encodeURIComponent(platform)}`,
    'PATCH',
    { account_id: accountId, account_name: accountName || null, updated_at: new Date().toISOString() }
  );
  return res.json({ ok: true });
}

// ── ROUTER PRINCIPAL ──────────────────────────────────────
export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action;

  // Rutas públicas de usuario (sin admin secret)
  try {
    if (action === 'save-recommendation')   return await handleSaveRecommendation(req, res);
    if (action === 'get-recommendations')   return await handleGetRecommendations(req, res);
    if (action === 'update-recommendation') return await handleUpdateRecommendation(req, res);
    if (action === 'save-snapshot')         return await handleSaveSnapshot(req, res);
    if (action === 'get-snapshots')         return await handleGetSnapshots(req, res);
    // Platform connections
    if (action === 'get-connection')        return await handleGetConnection(req, res);
    if (action === 'disconnect-platform')   return await handleDisconnectPlatform(req, res);
    // Alertas
    if (action === 'check-alerts')          return await handleCheckAlerts(req, res);
    if (action === 'get-alerts')            return await handleGetAlerts(req, res);
    if (action === 'mark-alerts-read')      return await handleMarkAlertsRead(req, res);
    if (action === 'dismiss-alert')         return await handleDismissAlert(req, res);
    // Meta token refresh
    if (action === 'refresh-meta-token')    return await handleRefreshMetaToken(req, res);
    // Sprint 3
    if (action === 'log-api-action')        return await handleLogApiAction(req, res);
    if (action === 'save-connection')       return await handleSaveConnection(req, res);
    if (action === 'assign-connection')     return await handleAssignConnection(req, res);
    if (action === 'competitive-search')    return await handleCompetitiveSearch(req, res);
    if (action === 'update-preferences')    return await handleUpdatePreferences(req, res);
    if (action === 'save-platform-account') return await handleSavePlatformAccount(req, res);
  } catch (err) {
    console.error('Admin user-action error:', err);
    return res.status(500).json({ error: err.message });
  }

  // Rutas de administrador
  if (!authCheck(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    // Tickets de soporte, para el panel de admin.acuarius.app
    if (action === 'uso-ia')           return await handleUsoIA(req, res);
    if (action === 'tickets')          return await handleTickets(req, res);
    if (action === 'ticket-update')    return await handleTicketUpdate(req, res);
    if (action === 'metrics')          return await handleMetrics(req, res);
    if (action === 'users')            return await handleUsers(req, res);
    if (action === 'set-plan')         return await handleSetPlan(req, res);
    if (action === 'create-test-user') return await handleCreateTestUser(req, res);
    if (action === 'delete-test-user')   return await handleDeleteTestUser(req, res);
    if (action === 'reset-test-password') return await handleResetTestPassword(req, res);
    if (action === 'sync')             return await handleSync(req, res);
    return res.status(400).json({ error: 'action requerido' });
  } catch (err) {
    console.error('Admin error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ── Tickets de soporte ───────────────────────────────────────────────────────
// Los abre el asistente de soporte de la app cuando no puede resolver algo, con
// la radiografía de la cuenta ya dentro. Aquí se listan y se cambian de estado
// para el panel de admin.acuarius.app.
//
//   GET  ?action=tickets[&estado=abierto|en_curso|resuelto|cerrado|todos][&limit=]
//        → { tickets: [...] }
//   POST ?action=ticket-update  { id, estado?, respuesta? }
//        → { ticket }
//
// Ambas piden la cabecera x-admin-secret, como el resto del panel.
async function handleTickets(req, res) {
  const estado = req.query.estado;
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
  const filtro = estado && estado !== 'todos' ? `&estado=eq.${encodeURIComponent(estado)}` : '';
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/support_tickets?select=*${filtro}&order=created_at.desc&limit=${limit}`,
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
  );
  if (!r.ok) return res.status(500).json({ error: (await r.text()).slice(0, 300) });
  return res.status(200).json({ tickets: await r.json() });
}

async function handleTicketUpdate(req, res) {
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  if (!body.id) return res.status(400).json({ error: 'Falta el ticket' });
  const cambios = { updated_at: new Date().toISOString() };
  if (body.estado) cambios.estado = String(body.estado).slice(0, 20);
  if (body.respuesta !== undefined) cambios.respuesta = String(body.respuesta || '').slice(0, 4000) || null;

  // Con quién hablamos y de qué. Se lee ANTES de escribir para saber si la
  // respuesta es nueva: reenviar el mismo correo cada vez que se toca el estado
  // sería avisar por avisar.
  const previo = await fetch(
    `${SUPABASE_URL}/rest/v1/support_tickets?id=eq.${encodeURIComponent(body.id)}&select=email,asunto,respuesta&limit=1`,
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
  ).then(r => (r.ok ? r.json() : [])).then(r => r?.[0]).catch(() => null);
  const respuestaNueva = cambios.respuesta && cambios.respuesta !== (previo?.respuesta || null);

  const r = await fetch(`${SUPABASE_URL}/rest/v1/support_tickets?id=eq.${encodeURIComponent(body.id)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify(cambios),
  });
  if (!r.ok) return res.status(500).json({ error: (await r.text()).slice(0, 300) });
  const filas = await r.json();
  if (!filas.length) return res.status(404).json({ error: 'No encontrado' });

  // El aviso por correo va después de guardar y no puede tumbar la respuesta:
  // el dato es la respuesta, el correo es la cortesía. Pero se espera y se
  // devuelve si salió, porque decirle al equipo "enviado" cuando no salió es la
  // peor forma de fallar aquí.
  let avisado = false;
  if (respuestaNueva && previo?.email && process.env.RESEND_API_KEY) {
    try {
      const { emailHtml, bloque, esc, RESPONDER_A } = await import('./_email-layout.js');
      const env = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Acuarius <soporte@app.acuarius.app>', reply_to: RESPONDER_A,
          to: previo.email,
          subject: 'Sobre tu consulta: ' + (previo.asunto || 'soporte'),
          html: emailHtml({
            titulo: 'Te respondimos',
            intro: `Sobre lo que nos contaste: <strong>${esc(previo.asunto || 'tu consulta')}</strong>.`,
            preheader: String(cambios.respuesta).slice(0, 90),
            cuerpo: bloque(`<span style="white-space:pre-wrap">${esc(cambios.respuesta)}</span>`),
            cta: { texto: 'Volver a Acuarius', url: 'https://app.acuarius.app' },
            pie: 'Si sigue sin funcionarte, respóndenos desde el chat de soporte de la app y seguimos por ahí.',
          }),
        }),
      });
      avisado = env.ok;
    } catch (e) {
      console.error('aviso de ticket:', e?.message);
    }
  }

  return res.status(200).json({ ticket: filas[0], avisado });
}

// ── Consumo de IA ────────────────────────────────────────────────────────────
// Cuánto gasta cada cuenta y en qué. Es lo que hay que mirar antes de poner
// cupos: sin esto, cualquier límite sería un número inventado.
//
//   GET ?action=uso-ia[&dias=30]  →  { desde, total, por_cuenta: [...], por_origen: {...} }
async function handleUsoIA(req, res) {
  const dias = Math.min(parseInt(req.query.dias, 10) || 30, 365);
  const desde = new Date(Date.now() - dias * 86400000).toISOString();

  // Se piden las filas y se agregan aquí. PostgREST sabe agrupar, pero con una
  // sola llamada y este volumen sale igual de rápido y se lee mucho mejor.
  const filas = await fetch(
    `${SUPABASE_URL}/rest/v1/ai_usage?created_at=gte.${encodeURIComponent(desde)}` +
    `&select=user_id,origen,agente,modelo,costo,tokens_in,tokens_out,cache_write,cache_read&limit=50000`,
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
  ).then(r => (r.ok ? r.json() : [])).catch(() => []);

  const cuentas = new Map();
  const origenes = {};
  const agentes = {};
  let total = 0;

  for (const f of filas) {
    const c = Number(f.costo) || 0;
    total += c;
    origenes[f.origen] = (origenes[f.origen] || 0) + c;
    if (f.agente) agentes[f.agente] = (agentes[f.agente] || 0) + c;
    const a = cuentas.get(f.user_id) || { user_id: f.user_id, costo: 0, llamadas: 0, por_origen: {} };
    a.costo += c;
    a.llamadas += 1;
    a.por_origen[f.origen] = (a.por_origen[f.origen] || 0) + c;
    cuentas.set(f.user_id, a);
  }

  // El correo hace legible la lista: un id de Clerk no le dice nada a nadie.
  const ids = [...cuentas.keys()];
  if (ids.length) {
    const usuarios = await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=in.(${ids.map(encodeURIComponent).join(',')})&select=id,email,name,plan`,
      { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
    ).then(r => (r.ok ? r.json() : [])).catch(() => []);
    for (const u of usuarios || []) {
      const a = cuentas.get(u.id);
      if (a) { a.email = u.email; a.nombre = u.name; a.plan = u.plan; }
    }
  }

  const por_cuenta = [...cuentas.values()].sort((x, y) => y.costo - x.costo);
  return res.status(200).json({
    desde, dias,
    total: Number(total.toFixed(4)),
    llamadas: filas.length,
    por_origen: Object.fromEntries(Object.entries(origenes).map(([k, v]) => [k, Number(v.toFixed(4))])),
    por_agente: Object.fromEntries(Object.entries(agentes).map(([k, v]) => [k, Number(v.toFixed(4))])),
    por_cuenta: por_cuenta.map(a => ({ ...a, costo: Number(a.costo.toFixed(4)) })),
  });
}

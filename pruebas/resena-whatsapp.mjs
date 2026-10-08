// «Pedir reseña» por WhatsApp: node pruebas/resena-whatsapp.mjs
//
// El paso le pasaba el texto a actionSendWhatsapp como `message`, pero esa
// función lee `body`: el WhatsApp salía vacío, sin el enlace firmado, y el
// historial decía «sent». Aquí corre el cron de verdad sobre un backend falso
// (Supabase + Meta) con un lead inventado, y se mira lo que llega a Meta.

process.env.SUPABASE_URL = 'https://falso.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'clave-falsa';
process.env.CRON_SECRET = 'secreto';
process.env.CLERK_SECRET_KEY = 'clerk-falsa';

// Jueves hábil a las 10:00 de Bogotá, salvo que una prueba mueva el reloj.
const RealDate = Date;
const aBogota = (t) => RealDate.parse(t + '-05:00');
let DESFASE = aBogota('2026-10-01T10:00') - RealDate.now();
const ponerReloj = (t) => { DESFASE = aBogota(t) - RealDate.now(); };
globalThis.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [RealDate.now() + DESFASE])); }
  static now() { return RealDate.now() + DESFASE; }
};

let fallos = 0;
const chk = (nombre, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${nombre}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

const TEL = '+57 300 000 0000';   // inventado

function montar(pasos, { conversacion = true, errorMeta = null, yaPedida = false } = {}) {
  const auto = { id: 'auto-r', user_id: 'user-prueba', active: true, trigger: { type: 'lead_created' }, steps: pasos };
  const lead = { id: 'lead-prueba', user_id: 'user-prueba', name: 'Ana Prueba', phone: TEL, email: null,
                 stage: 'ganado', deleted_at: null, tags: [], notes: null };
  const trabajo = { id: 'j-1', automation_id: 'auto-r', user_id: 'user-prueba', lead_id: lead.id,
                    step_index: 0, status: 'pending', run_at: '2020-01-01T00:00:00Z' };
  const m = { trabajo, lead, aMeta: [], bitacora: [], actividades: [], chat: [] };

  globalThis.fetch = async (url, opciones = {}) => {
    const u = decodeURIComponent(String(url));
    const met = opciones.method || 'GET';
    const cuerpo = opciones.body ? JSON.parse(opciones.body) : null;
    const ok = (d, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(d), json: async () => d });

    if (u.startsWith('https://api.clerk.com/')) return ok({ public_metadata: { plan: 'agency' }, email_addresses: [] });
    if (u.includes('graph.facebook.com')) {
      m.aMeta.push(cuerpo);
      return errorMeta ? ok({ error: errorMeta }, 400) : ok({ messages: [{ id: 'wamid.x' }] });
    }
    if (/api\.resend\.com|labsmobile/.test(u)) throw new Error('no debería llamarse: ' + u);
    if (u.includes('/automations?') && u.includes('lead_inactive')) return ok([]);
    if (u.includes('/automations?')) return ok([auto]);
    if (u.includes('/automation_jobs?') && met === 'GET') return ok(trabajo.status === 'pending' ? [trabajo] : []);
    if (u.includes('/automation_jobs?') && met === 'PATCH') { Object.assign(trabajo, cuerpo); return ok([]); }
    if (u.includes('/automation_logs')) { m.bitacora.push(...[].concat(cuerpo)); return ok([]); }
    if (u.includes('/leads?') && met === 'GET') return ok([lead]);
    if (u.includes('/user_profiles?') && u.includes('__resenas__'))
      return ok([{ profile_data: { _cuenta: { url: 'https://g.page/r/ejemplo/review' } } }]);
    if (u.includes('/lead_activities?') && met === 'GET')
      return ok(yaPedida || m.actividades.some(a => a.metadata?.resena === 'pedida') ? [{ id: 'a' }] : []);
    if (u.includes('/lead_activities') && met === 'POST') { m.actividades.push(cuerpo); return ok([]); }
    if (u.includes('/chat_conversations?'))
      return ok(conversacion ? [{ id: 'conv-1', contact_id: '573000000000', channel: 'whatsapp', connection_id: 'con-1' }] : []);
    if (u.includes('/channel_connections?'))
      return ok([{ id: 'con-1', external_id: 'phone-id-falso', access_token: 'token-falso' }]);
    if (u.includes('/chat_messages') && met === 'POST') { m.chat.push(cuerpo); return ok([]); }
    return ok([]);
  };
  return m;
}

const peticion = { headers: { authorization: 'Bearer secreto' } };
const respuesta = () => { const r = {}; r.status = () => r; r.json = (d) => { r.cuerpo = d; return r; }; return r; };
const { default: cron } = await import('../api/cron-automations.js');
const RESENA = { type: 'pedir_resena', canal: 'whatsapp', mensaje: 'Hola {{nombre}}, ¿nos dejas una reseña?' };

console.log('\nLa reseña llega por WhatsApp con su enlace\n');
{
  const m = montar([RESENA]);
  await cron(peticion, respuesta());
  const texto = m.aMeta[0]?.text?.body || '';
  chk('se llama a Meta una vez', m.aMeta.length === 1, String(m.aMeta.length));
  chk('el mensaje trae el texto con el nombre', texto.startsWith('Hola Ana Prueba, ¿nos dejas una reseña?'), texto);
  chk('y el enlace firmado de api/resenas', /\nhttps:\/\/app\.acuarius\.app\/api\/resenas\?t=[^.\s]+\.[0-9a-f]{32}$/.test(texto), texto);
  chk('el historial dice «sent»', m.bitacora.some(l => l.action === 'pedir_resena' && l.result === 'sent'), JSON.stringify(m.bitacora));
  chk('queda la marca «pedida» en la ficha', m.actividades.some(a => a.metadata?.resena === 'pedida' && a.metadata?.canal === 'whatsapp'));
  chk('y el mensaje queda en la conversación del Inbox', m.chat[0]?.content === texto);
}

console.log('\nUna sola vez por lead\n');
{
  const m = montar([RESENA], { yaPedida: true });
  await cron(peticion, respuesta());
  chk('si ya se pidió, no se llama a Meta', m.aMeta.length === 0);
  chk('y el historial lo explica', m.bitacora.some(l => /ya se le pidió/.test(l.detail)), JSON.stringify(m.bitacora));
}

console.log('\nSin conversación en el Inbox: falla a la vista\n');
{
  const m = montar([RESENA], { conversacion: false });
  await cron(peticion, respuesta());
  const l = m.bitacora.find(x => x.action === 'pedir_resena');
  chk('no se llama a Meta', m.aMeta.length === 0);
  chk('el historial lo marca en rojo (failed)', l?.result === 'failed', JSON.stringify(l));
  chk('con el motivo', /No se pidió la reseña por WhatsApp: Sin conversación de Inbox/.test(l?.detail || ''), l?.detail);
  chk('la ficha del lead lo cuenta', m.actividades.some(a => a.metadata?.resena === 'fallida' && /Sin conversación/.test(a.content)));
  chk('y NO queda como pedida (se podrá volver a pedir)', !m.actividades.some(a => a.metadata?.resena === 'pedida'));
}

console.log('\nMeta rechaza el envío\n');
for (const [error, patron, que] of [
  [{ code: 131047, message: 'Re-engagement message' }, /más de 24 h/, 'fuera de la ventana de 24 h'],
  [{ code: 10, message: 'Application does not have permission for this action' }, /revisión de Meta/, 'sin permiso (App Review)'],
]) {
  const m = montar([RESENA], { errorMeta: error });
  await cron(peticion, respuesta());
  const l = m.bitacora.find(x => x.action === 'pedir_resena');
  chk(`${que}: failed con motivo en español`, l?.result === 'failed' && patron.test(l.detail), l?.detail);
  chk(`${que}: no queda como pedida`, !m.actividades.some(a => a.metadata?.resena === 'pedida'));
  chk(`${que}: no se apunta en el Inbox un mensaje que no salió`, m.chat.length === 0);
}

console.log('\nEl paso «Enviar WhatsApp» normal sigue igual\n');
{
  const m = montar([{ type: 'send_whatsapp', body: 'Hola {{nombre}}, te escribimos de la tienda' }]);
  await cron(peticion, respuesta());
  chk('manda su body con las variables', m.aMeta[0]?.text?.body === 'Hola Ana Prueba, te escribimos de la tienda', JSON.stringify(m.aMeta));
  chk('y queda «sent»', m.bitacora.some(l => l.action === 'send_whatsapp' && l.result === 'sent'));
}
{
  const m = montar([{ type: 'send_whatsapp', body: '' }]);
  await cron(peticion, respuesta());
  const l = m.bitacora.find(x => x.action === 'send_whatsapp');
  chk('sin mensaje no manda un WhatsApp vacío', m.aMeta.length === 0);
  chk('y lo dice en el historial', l?.result === 'failed' && /no tiene mensaje/.test(l.detail), JSON.stringify(l));
}

console.log('\nEl horario de la Ley 2300\n');
{
  ponerReloj('2026-10-04T10:00');   // domingo
  const m = montar([RESENA]);
  await cron(peticion, respuesta());
  chk('un domingo la reseña no sale', m.aMeta.length === 0);
  chk('el paso espera, no se pierde', m.trabajo.status === 'pending' && m.trabajo.step_index === 0, JSON.stringify(m.trabajo));
  chk('y el historial cita la Ley 2300', m.bitacora.some(l => /Ley 2300/.test(l.detail)));
  ponerReloj('2026-10-01T10:00');
}

console.log(fallos ? `\n✗ ${fallos} fallo(s)\n` : '\n✓ todo bien\n');
process.exit(fallos ? 1 : 0);

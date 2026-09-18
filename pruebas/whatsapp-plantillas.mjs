// Envío masivo por plantillas: node pruebas/whatsapp-plantillas.mjs
//
// Lo que se vigila es el número del cliente. Pasarse del techo de Meta no da un
// error claro: estrangula, la calidad cae, las plantillas se pausan y el número
// queda restringido semanas. Así que el techo, el parámetro vacío y el error
// pasajero son las tres cosas que esta prueba no deja romper.

process.env.SUPABASE_URL = 'https://falso.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'clave-falsa';
process.env.RESEND_API_KEY = 'resend-falsa';
process.env.CRON_SECRET = 'secreto';

import { readFileSync } from 'node:fs';
import { huecosDe } from '../api/_whatsapp.js';

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

console.log('\nLeer los huecos de una plantilla\n');
{
  const c = [
    { type: 'HEADER', format: 'TEXT', text: 'Hola {{1}}' },
    { type: 'BODY', text: 'Tu cita de {{1}} es el {{2}}. Gracias, {{1}}.' },
    { type: 'FOOTER', text: 'Sin variables' },
  ];
  const h = huecosDe(c);
  chk('cuenta los del encabezado', h.header === 1, String(h.header));
  chk('cuenta los del cuerpo sin contar repetidos dos veces', h.body === 2, String(h.body));
  chk('guarda el texto para previsualizar', /Tu cita de/.test(h.cuerpo_texto));
  chk('una plantilla sin variables da cero', huecosDe([{ type: 'BODY', text: 'Hola' }]).body === 0);
}

// ── Backend falso ────────────────────────────────────────────────────────────
function montar(n, { tope = null, plantilla = null, metaError = null, sinEmpresa = false } = {}) {
  const campana = {
    id: 'c1', user_id: 'u1', channel: 'whatsapp', status: 'queued',
    subject: null, body: 'texto plano de respaldo', stats: { total: n }, scheduled_at: null,
    wa_template: plantilla,
  };
  const cola = Array.from({ length: n }, (_, i) => ({
    id: `r-${String(i).padStart(4, '0')}`, campaign_id: 'c1', lead_id: `l-${i}`, status: 'pending',
  }));
  const leads = Object.fromEntries(cola.map((r, i) => [r.lead_id, {
    id: r.lead_id, name: `Persona ${i}`, company: sinEmpresa && i === 2 ? null : `Empresa ${i}`,
    phone: `+57 300 000 ${String(1000 + i).slice(-4)}`, deleted_at: null, tags: [],
  }]));
  const conexion = {
    id: 'conn-1', channel: 'whatsapp', is_active: true,
    external_id: '1234567890', waba_id: 'waba-1', access_token: 'tok',
  };
  let perfil = tope ? { 'conn-1': { tope } } : {};
  const est = { enviados: [], perfilGuardado: null };

  globalThis.fetch = async (url, op = {}) => {
    const u = String(url), met = op.method || 'GET';
    const cuerpo = op.body ? JSON.parse(op.body) : null;
    const ok = (d) => ({ ok: true, status: 200, text: async () => JSON.stringify(d), json: async () => d });

    if (u.includes('graph.facebook.com')) {
      if (metaError) return ok({ error: metaError });
      est.enviados.push(cuerpo);
      return ok({ messages: [{ id: 'wamid.' + est.enviados.length }] });
    }
    if (u.includes('/campaigns?') && met === 'GET') return ok([campana]);
    if (u.includes('/campaigns?') && met === 'PATCH') { Object.assign(campana, cuerpo); return ok([]); }
    if (u.includes('/campaign_recipients?') && met === 'GET') {
      const p = new URL(u.replace('/rest/v1', ''));
      const lim = Math.min(Number(p.searchParams.get('limit')) || 1000, 1000);
      const off = Number(p.searchParams.get('offset')) || 0;
      return ok(cola.filter(r => r.status === 'pending').slice(off, off + lim)
                    .map(({ id, campaign_id, lead_id }) => ({ id, campaign_id, lead_id })));
    }
    if (u.includes('/campaign_recipients') && met === 'POST') {
      for (const f of cuerpo) { const x = cola.find(r => r.id === f.id); if (x) Object.assign(x, f); }
      return ok([]);
    }
    if (u.includes('/leads?')) {
      const ids = decodeURIComponent(u).match(/id=in\.\(([^)]*)\)/)?.[1].split(',') || [];
      return ok(ids.map(i => leads[i]).filter(Boolean));
    }
    if (u.includes('/channel_connections')) return ok([conexion]);
    if (u.includes('/chat_conversations')) return ok([]);
    if (u.includes('/user_profiles') && met === 'GET') return ok([{ profile_data: perfil }]);
    if (u.includes('/user_profiles') && met === 'POST') { est.perfilGuardado = cuerpo.profile_data; return ok([]); }
    return ok([]);
  };
  return { campana, cola, leads, est };
}

const PLANTILLA = { name: 'promo_septiembre', language: 'es', header: [], body: ['nombre', 'empresa'] };
const peticion = { headers: { authorization: 'Bearer secreto' } };
const respuesta = () => { const r = {}; r.status = () => r; r.json = (d) => { r.cuerpo = d; return r; }; return r; };
const { default: cron } = await import('../api/cron-campaigns.js');

console.log('\nUna campaña con plantilla, sin conversación previa\n');
{
  const m = montar(10, { plantilla: PLANTILLA });
  await cron(peticion, respuesta());
  chk('salen los 10 aunque nadie hubiera escrito antes',
      m.cola.filter(r => r.status === 'sent').length === 10,
      `enviados=${m.cola.filter(r => r.status === 'sent').length}`);
  const s = m.est.enviados[0];
  chk('el mensaje va como plantilla', s?.type === 'template');
  chk('con su nombre e idioma', s?.template?.name === 'promo_septiembre' && s?.template?.language?.code === 'es');
  chk('los huecos se rellenan en orden',
      s?.template?.components?.[0]?.parameters?.[0]?.text === 'Persona 0' &&
      s?.template?.components?.[0]?.parameters?.[1]?.text === 'Empresa 0');
  chk('el teléfono va en dígitos, sin signos', /^\d+$/.test(s?.to || ''), s?.to);
}

console.log('\nEl techo de Meta: 250 al día\n');
{
  const m = montar(400, { plantilla: PLANTILLA });   // sin tope propio → 250
  await cron(peticion, respuesta());
  const enviados = m.cola.filter(r => r.status === 'sent').length;
  chk('envía exactamente el cupo, ni uno más', enviados === 250, `fueron ${enviados}`);
  chk('los 150 restantes quedan PENDIENTES, no fallidos',
      m.cola.filter(r => r.status === 'pending').length === 150);
  chk('la campaña NO se cierra', m.campana.status !== 'sent', m.campana.status);
  chk('se anota lo enviado para no repetirlo mañana',
      m.est.perfilGuardado?.['conn-1']?.[new Date().toISOString().slice(0, 10)] === 250);
}

console.log('\nCuando Meta ya subió el escalón\n');
{
  const m = montar(400, { plantilla: PLANTILLA, tope: 2000 });
  await cron(peticion, respuesta());
  chk('con el tope subido salen los 400', m.cola.filter(r => r.status === 'sent').length === 400);
}

console.log('\nUn lead al que le falta un dato de la plantilla\n');
{
  const m = montar(5, { plantilla: PLANTILLA, sinEmpresa: true });
  await cron(peticion, respuesta());
  const saltado = m.cola.find(r => r.lead_id === 'l-2');
  chk('se salta, no se envía con el hueco vacío', saltado?.status === 'skipped', saltado?.status);
  chk('y dice qué dato faltaba', /empresa/.test(saltado?.detail || ''), saltado?.detail);
  chk('los demás salen igual', m.cola.filter(r => r.status === 'sent').length === 4);
  chk('a Meta nunca le llegó un parámetro vacío',
      m.est.enviados.every(e => e.template.components[0].parameters.every(p => p.text.trim())));
}

console.log('\nErrores de Meta: pasajeros y definitivos\n');
{
  const m = montar(5, { plantilla: PLANTILLA, metaError: { code: 131049, message: 'limite de ritmo' } });
  await cron(peticion, respuesta());
  chk('un 131049 deja las filas pendientes para reintentar',
      m.cola.filter(r => r.status === 'pending').length === 5,
      `pendientes=${m.cola.filter(r => r.status === 'pending').length}`);
}
{
  const m = montar(5, { plantilla: PLANTILLA, metaError: { code: 132001, message: 'plantilla no existe' } });
  await cron(peticion, respuesta());
  chk('un 132001 es definitivo: quedan fallidas con el motivo',
      m.cola.filter(r => r.status === 'failed').length === 5);
  chk('y el motivo llega a la ficha', /132001/.test(m.cola[0].detail || ''), m.cola[0].detail);
}

console.log('\nSin plantilla sigue haciendo falta la conversación\n');
{
  const m = montar(5, { plantilla: null });
  await cron(peticion, respuesta());
  chk('se saltan por no tener conversación de inbox',
      m.cola.every(r => r.status === 'skipped' && /conversación/.test(r.detail || '')),
      m.cola[0]?.detail);
}

console.log('\nY lo que dice el código fuente\n');
{
  const camp = readFileSync(new URL('../api/campaigns.js', import.meta.url), 'utf8');
  const cron = readFileSync(new URL('../api/cron-campaigns.js', import.meta.url), 'utf8');
  chk('encolar comprueba la plantilla contra Meta', /await revisarPlantilla\(/.test(camp));
  chk('y rechaza si no está aprobada', /Solo se pueden enviar las aprobadas/.test(camp));
  chk('el estado se pregunta a Meta, no a una copia nuestra', /plantillasDeMeta\(conn, 'name,status,language'\)/.test(camp));
  chk('el techo diario está declarado', /const TOPE_DIARIO = 250/.test(cron));
  chk('la campaña guarda su plantilla', /out\.wa_template/.test(camp));
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);

// Prueba del motor de automatizaciones: node pruebas/motor-automatizaciones.mjs
//
// Backend falso (Supabase + Clerk) y el cron de verdad corriendo encima.
// Lo que se mide no es que "funcione" —ya funcionaba— sino cuántas peticiones
// cuesta, que es lo que lo tenía en 50 trabajos cada diez minutos.

process.env.SUPABASE_URL = 'https://falso.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'clave-falsa';
process.env.CRON_SECRET = 'secreto';
process.env.CLERK_SECRET_KEY = 'clerk-falsa';

import { readFileSync } from 'node:fs';

let fallos = 0;
const chk = (nombre, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${nombre}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

const TOPE_POSTGREST = 1000;

function montar(nTrabajos, { trabajosPorLead = 1, romperLead = null } = {}) {
  const auto = {
    id: 'auto-1', user_id: 'user-1', active: true,
    trigger: { type: 'lead_created' },
    steps: [{ type: 'add_note', text: 'Hola {{nombre}}' }, { type: 'change_stage', stage: 'contactado' }],
  };
  const nLeads = Math.ceil(nTrabajos / trabajosPorLead);
  const leads = {};
  for (let i = 0; i < nLeads; i++) {
    leads[`l-${i}`] = { id: `l-${i}`, name: `Persona ${i}`, notes: null, stage: 'nuevo', deleted_at: null, tags: [] };
  }
  const trabajos = Array.from({ length: nTrabajos }, (_, i) => ({
    id: `j-${String(i).padStart(5, '0')}`, automation_id: 'auto-1', user_id: 'user-1',
    lead_id: `l-${i % nLeads}`, step_index: 0, status: 'pending', run_at: '2020-01-01T00:00:00Z',
  }));

  const cuenta = { automations: 0, leadsGet: 0, logs: 0, filasLog: 0, colaGet: 0 };
  const enVuelo = { ahora: 0, max: 0 };
  const porLeadSolapado = new Set();
  const activosPorLead = {};

  globalThis.fetch = async (url, opciones = {}) => {
    const u = String(url);
    const met = opciones.method || 'GET';
    const cuerpo = opciones.body ? JSON.parse(opciones.body) : null;
    const ok = (d) => ({ ok: true, status: 200, text: async () => JSON.stringify(d), json: async () => d });

    if (u.startsWith('https://api.clerk.com/')) {
      return { ok: true, json: async () => ({ public_metadata: { plan: 'agency' }, email_addresses: [{ email_address: 'x@y.com' }] }) };
    }

    // Cada petición tarda un poco: sin esto el paralelismo no se nota.
    enVuelo.ahora++; enVuelo.max = Math.max(enVuelo.max, enVuelo.ahora);
    await new Promise(r => setTimeout(r, 1));
    enVuelo.ahora--;

    if (u.includes('/automations?') && u.includes('lead_inactive')) return ok([]);
    if (u.includes('/automations?')) { cuenta.automations++; return ok([auto]); }

    if (u.includes('/automation_jobs?') && met === 'GET') {
      cuenta.colaGet++;
      const p = new URL(u.replace('/rest/v1', ''));
      const limit = Math.min(Number(p.searchParams.get('limit')) || TOPE_POSTGREST, TOPE_POSTGREST);
      const offset = Number(p.searchParams.get('offset')) || 0;
      return ok(trabajos.filter(t => t.status === 'pending').slice(offset, offset + limit));
    }
    if (u.includes('/automation_jobs?') && met === 'PATCH') {
      const id = decodeURIComponent(u).match(/id=eq\.([^&]+)/)?.[1];
      const t = trabajos.find(x => x.id === id);
      if (t) Object.assign(t, cuerpo);
      return ok([]);
    }
    if (u.includes('/automation_logs')) {
      cuenta.logs++;
      cuenta.filasLog += Array.isArray(cuerpo) ? cuerpo.length : 1;
      if (!Array.isArray(cuerpo)) throw new Error('la bitacora deberia escribirse por tandas');
      return ok([]);
    }
    if (u.includes('/leads?') && met === 'GET') {
      cuenta.leadsGet++;
      const ids = decodeURIComponent(u).match(/id=in\.\(([^)]*)\)/)?.[1].split(',') || [];
      return ok(ids.map(i => leads[i]).filter(Boolean));
    }
    if (u.includes('/leads?') && met === 'PATCH') {
      const id = decodeURIComponent(u).match(/id=eq\.([^&]+)/)?.[1];
      if (romperLead && id === romperLead) throw new Error('la base se cayo a mitad');
      // ¿Dos flujos del mismo lead escribiendo a la vez?
      if (activosPorLead[id]) porLeadSolapado.add(id);
      activosPorLead[id] = true;
      await new Promise(r => setTimeout(r, 1));
      activosPorLead[id] = false;
      if (leads[id]) Object.assign(leads[id], cuerpo);
      return ok([]);
    }
    return ok([]);
  };
  return { auto, trabajos, leads, cuenta, enVuelo, porLeadSolapado };
}

const peticion = { headers: { authorization: 'Bearer secreto' } };
const respuesta = () => { const r = {}; r.status = () => r; r.json = (d) => { r.cuerpo = d; return r; }; return r; };

const { default: cron } = await import('../api/cron-automations.js');

console.log('\n300 trabajos en una corrida (antes el tope eran 50)\n');
{
  const m = montar(300);
  const res = respuesta();
  await cron(peticion, res);

  const hechos = m.trabajos.filter(t => t.status === 'done').length;
  chk('los 300 se procesan, no 50', hechos === 300, `hechos=${hechos}`);
  chk('el handler lo reporta', res.cuerpo?.processed === 300, JSON.stringify(res.cuerpo));

  chk('la automatización se lee 1 vez, no 300',
      m.cuenta.automations === 1, `fueron ${m.cuenta.automations}`);
  chk('los leads se leen en 2 tandas, no 300',
      m.cuenta.leadsGet === 2, `fueron ${m.cuenta.leadsGet}`);
  chk('la bitácora se escribe en 2 tandas, no 600',
      m.cuenta.logs <= 2, `fueron ${m.cuenta.logs}`);
  chk('pero se registran los 600 pasos igual',
      m.cuenta.filasLog === 600, `fueron ${m.cuenta.filasLog}`);

  chk('los trabajos avanzan en paralelo', m.enVuelo.max > 1, `máximo en vuelo: ${m.enVuelo.max}`);
  chk('sin pasarse del límite de concurrencia', m.enVuelo.max <= 8, `máximo ${m.enVuelo.max}`);
  chk('el flujo hizo su trabajo', m.leads['l-0'].stage === 'contactado' && /Hola Persona 0/.test(m.leads['l-0'].notes || ''));
}

console.log('\nVarios flujos sobre el MISMO contacto\n');
{
  const m = montar(40, { trabajosPorLead: 4 });
  await cron(peticion, respuesta());
  chk('los 40 se procesan', m.trabajos.filter(t => t.status === 'done').length === 40);
  chk('nunca dos flujos del mismo lead a la vez (se pisarían las notas)',
      m.porLeadSolapado.size === 0, `solapados: ${[...m.porLeadSolapado].join(', ')}`);
  chk('las dos notas del flujo quedan, no una encima de otra',
      (m.leads['l-0'].notes || '').split('\n').length >= 4);
}

console.log('\nUna cola de más de 1.000\n');
{
  const m = montar(1200);
  await cron(peticion, respuesta());
  const hechos = m.trabajos.filter(t => t.status === 'done').length;
  // El presupuesto es 600: debe tomar 600, no 1.000 ni 50.
  chk('respeta el presupuesto de la corrida', hechos === 600, `hechos=${hechos}`);
  chk('deja el resto pendiente para la siguiente',
      m.trabajos.filter(t => t.status === 'pending').length === 600);
}

console.log('\nCuando un trabajo revienta a mitad\n');
{
  const m = montar(20, { romperLead: 'l-3' });
  await cron(peticion, respuesta());
  chk('ese trabajo queda marcado como fallido',
      m.trabajos.find(t => t.lead_id === 'l-3')?.status === 'failed');
  chk('los otros 19 salen adelante igual',
      m.trabajos.filter(t => t.status === 'done').length === 19);
  chk('y la bitácora se escribió pese al fallo', m.cuenta.filasLog > 0, `filas=${m.cuenta.filasLog}`);
  chk('el fallo quedó registrado con su motivo', m.cuenta.filasLog >= 20);
}

console.log('\nY lo que dice el código fuente\n');
{
  const src = readFileSync(new URL('../api/cron-automations.js', import.meta.url), 'utf8');
  chk('ya no queda el tope de 50', !/select=\*&order=run_at\.asc&limit=50/.test(src));
  chk('el presupuesto está declarado', /const PRESUPUESTO\s*=\s*600/.test(src));
  chk('los envíos de Resend pasan por turno',
      !/await fetch\('https:\/\/api\.resend\.com/.test(src) && /function fetchResend/.test(src));
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  chk('el cron declara su maxDuration', vercel.functions['api/cron-automations.js']?.maxDuration >= 60);
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);

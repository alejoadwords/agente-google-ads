// Prueba del motor de campañas: node pruebas/motor-campanas.mjs
//
// Levanta un backend falso (Supabase + Resend) y corre el cron de verdad
// contra él. No se prueban las piezas por separado: se prueba que una campaña
// entra por un lado y sale enviada por el otro, contando cuántas peticiones
// hicieron falta — que es exactamente lo que estaba mal.

process.env.SUPABASE_URL = 'https://falso.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'clave-falsa';
process.env.RESEND_API_KEY = 'resend-falsa';
process.env.CRON_SECRET = 'secreto';

import { readFileSync } from 'node:fs';

let fallos = 0;
const chk = (nombre, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${nombre}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

const TOPE_POSTGREST = 1000; // lo que hace el servidor de verdad

// ── Backend falso ────────────────────────────────────────────────────────────
function montar(nDestinatarios, { resendFalla = false, muchosSaltables = false } = {}) {
  const campana = {
    id: 'camp-1', user_id: 'user-1', channel: 'email', status: 'queued',
    subject: 'Hola {{nombre}}', body: 'Cuerpo para {{nombre}}', html: null,
    from_name: 'Acme', reply_to: null, stats: { total: nDestinatarios }, scheduled_at: null,
  };
  const cola = Array.from({ length: nDestinatarios }, (_, i) => ({
    id: `r-${String(i).padStart(5, '0')}`, campaign_id: 'camp-1',
    lead_id: `l-${String(i).padStart(5, '0')}`, status: 'pending',
  }));
  const leads = Object.fromEntries(cola.map((r, i) => [r.lead_id, {
    id: r.lead_id, name: `Persona ${i}`, email: `p${i}@ejemplo.com`, tags: [], deleted_at: null,
  }]));
  // Una sin correo y otra con el correo roto: deben saltarse sin tumbar su lote.
  if (nDestinatarios > 5) {
    leads['l-00003'].email = null;
    leads['l-00004'].email = 'esto no es un correo';
    leads['l-00005'].tags = ['no-email'];
  }
  // Para el caso feo: una cola llena de gente a la que no se puede escribir.
  // Cada tanda «avanza» contándolos, aunque a Resend no le entre ni uno.
  if (muchosSaltables) {
    Object.values(leads).forEach((l, i) => { if (i % 2) l.email = null; });
  }

  const cuenta = { resend: 0, escriturasCola: 0, escriturasEventos: 0, consultasLeads: 0, sobresVistos: 0 };
  const eventos = [];

  globalThis.fetch = async (url, opciones = {}) => {
    const u = String(url);
    const met = opciones.method || 'GET';
    const cuerpo = opciones.body ? JSON.parse(opciones.body) : null;
    const ok = (data) => ({ ok: true, status: 200, text: async () => JSON.stringify(data), json: async () => data });

    if (u.startsWith('https://api.resend.com/emails/batch')) {
      cuenta.resend++;
      cuenta.sobresVistos += cuerpo.length;
      if (cuerpo.length > 100) throw new Error('lote mayor de 100: Resend lo rechazaría');
      if (resendFalla) return {
        ok: false, status: resendFalla,
        json: async () => ({ message: resendFalla === 429 ? 'rate limit' : 'correo invalido' }),
      };
      return { ok: true, status: 200, json: async () => ({ data: cuerpo.map((_, i) => ({ id: `re-${cuenta.resend}-${i}` })) }) };
    }
    if (u.includes('/campaigns?') && met === 'GET') return ok([campana]);
    if (u.includes('/campaigns?') && met === 'PATCH') { Object.assign(campana, cuerpo); return ok([]); }

    if (u.includes('/campaign_recipients?') && met === 'GET') {
      const p = new URL(u.replace('/rest/v1', ''));
      const limit = Math.min(Number(p.searchParams.get('limit')) || TOPE_POSTGREST, TOPE_POSTGREST);
      const offset = Number(p.searchParams.get('offset')) || 0;
      return ok(cola.filter(r => r.status === 'pending').slice(offset, offset + limit)
                    .map(({ id, campaign_id, lead_id }) => ({ id, campaign_id, lead_id })));
    }
    if (u.includes('/campaign_recipients') && met === 'POST') {
      cuenta.escriturasCola++;
      if (!u.includes('on_conflict=id')) throw new Error('upsert sin on_conflict: daria 409');
      for (const f of cuerpo) {
        const fila = cola.find(r => r.id === f.id);
        if (fila) Object.assign(fila, f);
      }
      return ok([]);
    }
    if (u.includes('/leads?')) {
      cuenta.consultasLeads++;
      const ids = decodeURIComponent(u).match(/id=in\.\(([^)]*)\)/)?.[1].split(',') || [];
      if (ids.length > 250) throw new Error('consulta de leads demasiado larga');
      return ok(ids.map(i => leads[i]).filter(Boolean));
    }
    if (u.includes('/email_events') && met === 'POST') {
      cuenta.escriturasEventos++;
      eventos.push(...(Array.isArray(cuerpo) ? cuerpo : [cuerpo]));
      return ok([]);
    }
    return ok([]);
  };
  return { campana, cola, cuenta, eventos };
}

const peticion = { headers: { authorization: 'Bearer secreto' } };
const respuesta = () => { const r = {}; r.status = () => r; r.json = (d) => { r.cuerpo = d; return r; }; return r; };

const { default: cron } = await import('../api/cron-campaigns.js');

console.log('\nUna campaña de 1.200 destinatarios\n');
{
  const m = montar(1200);
  const res = respuesta();
  await cron(peticion, res);

  const enviados = m.cola.filter(r => r.status === 'sent').length;
  const saltados = m.cola.filter(r => r.status === 'skipped').length;
  const pendientes = m.cola.filter(r => r.status === 'pending').length;

  chk('no queda nadie pendiente', pendientes === 0, `quedan ${pendientes}`);
  chk('pasa de 1.000 — la cola se pagina', enviados + saltados === 1200, `${enviados}+${saltados}`);
  chk('se saltan los 3 imposibles (sin correo, roto, dado de baja)', saltados === 3, `saltados=${saltados}`);
  chk('nadie se envió dos veces', new Set(m.eventos.map(e => e.lead_id)).size === enviados);

  chk('Resend recibió 12 peticiones, no 1.197', m.cuenta.resend === 12, `fueron ${m.cuenta.resend}`);
  chk('la cola se escribió en 3 peticiones, no 1.200',
      m.cuenta.escriturasCola === 3, `fueron ${m.cuenta.escriturasCola}`);
  chk('los registros de envío, en 3 peticiones',
      m.cuenta.escriturasEventos === 3, `fueron ${m.cuenta.escriturasEventos}`);

  const antes = 1200 * 3 + 2;
  const ahora = m.cuenta.resend + m.cuenta.escriturasCola + m.cuenta.escriturasEventos + m.cuenta.consultasLeads;
  chk(`viajes de red: ${ahora} contra ${antes} del motor viejo`, ahora < antes / 20);

  chk('la campaña queda cerrada', m.campana.status === 'sent');
  chk('las estadísticas cuadran', m.campana.stats.sent === enviados && m.campana.stats.skipped === 3);
}

console.log('\nCuando Resend está saturado (429) — es pasajero\n');
{
  const m = montar(150, { resendFalla: 429 });
  const res429 = respuesta();
  await cron(peticion, res429);
  chk('nadie queda marcado como enviado', m.cola.filter(r => r.status === 'sent').length === 0);
  chk('los 147 siguen PENDIENTES para reintentar, no perdidos',
      m.cola.filter(r => r.status === 'pending').length === 147,
      `pendientes=${m.cola.filter(r => r.status === 'pending').length}`);
  chk('la campaña NO se cierra con gente sin enviar', m.campana.status !== 'sent', m.campana.status);
  chk('deja de insistirle a Resend: un solo lote', m.cuenta.resend === 1, `fueron ${m.cuenta.resend}`);
  chk('y no encadena otra tanda', res429.cuerpo.tandas === 1, `tandas=${res429.cuerpo.tandas}`);
  // EL CASO FEO: media cola sin correo. Cada tanda «avanza» contando saltados,
  // así que el corte de «no movió a nadie» no la para. Sin el corte por
  // saturación, esto le pegaba a Resend una vez por tanda durante los 85 s de
  // la función — justo después de que Resend pidiera que pararan.
  {
    const m2 = montar(400, { resendFalla: 429, muchosSaltables: true });
    const r2 = respuesta();
    await cron(peticion, r2);
    chk('con media cola saltable, sigue siendo UN solo intento',
        m2.cuenta.resend === 1, `fueron ${m2.cuenta.resend}`);
    chk('y una sola tanda', r2.cuerpo.tandas === 1, `tandas=${r2.cuerpo.tandas}`);
    chk('a quien no se llegó a intentar se le deja pendiente',
        m2.cola.filter(r => r.status === 'pending').length > 150,
        `pendientes=${m2.cola.filter(r => r.status === 'pending').length}`);
  }

  // Con VARIAS campañas en cola el banco no llega —monta una sola—, pero es
  // donde más se nota: sin el corte, el bucle pasaba a la campaña siguiente y
  // le pedía otro lote a Resend, hasta cinco por tanda. Se vigila en el código.
  {
    const src = readFileSync(new URL('../api/cron-campaigns.js', import.meta.url), 'utf8');
    chk('el corte por saturación sale también del bucle de campañas',
        /if \(saturado\) break;\s*\n\s*\}\s*\n\s*\/\/ Una tanda que no movió/.test(src));
    chk('y de la tanda', /if \(processed === alEmpezar\) break;\s*\n\s*if \(saturado\) break;/.test(src));
  }

  chk('no se registran envíos que no ocurrieron', m.eventos.length === 0);
}

console.log('\nCuando Resend rechaza por inválido (422) — es definitivo\n');
{
  const m = montar(150, { resendFalla: 422 });
  await cron(peticion, respuesta());
  const fallidos = m.cola.filter(r => r.status === 'failed').length;
  chk('quedan como fallidos, con motivo', fallidos === 147, `fueron ${fallidos}`);
  chk('el motivo llega a la fila', /invalido/.test(m.cola.find(r => r.status === 'failed')?.detail || ''));
  chk('no se reintenta en bucle: la campaña se cierra', m.campana.status === 'sent');
}

console.log('\nEl sobre que se le entrega a Resend\n');
{
  let visto = null;
  const m = montar(10);
  const original = globalThis.fetch;
  globalThis.fetch = async (url, op) => {
    if (String(url).includes('/emails/batch') && !visto) visto = JSON.parse(op.body)[0];
    return original(url, op);
  };
  await cron(peticion, respuesta());
  chk('lleva List-Unsubscribe (sin esto, el masivo va a spam)',
      !!visto?.headers?.['List-Unsubscribe']);
  chk('lleva la cabecera de baja en un clic',
      visto?.headers?.['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click');
  chk('las variables se resolvieron', /Persona 0/.test(visto?.subject || ''));
  chk('el remitente conserva el nombre de la campaña', /^Acme </.test(visto?.from || ''));
}

console.log('\nY lo que dice el código fuente\n');
{
  const src = readFileSync(new URL('../api/cron-campaigns.js', import.meta.url), 'utf8');
  chk('ya no queda el tope de 80', !/const BATCH = 80/.test(src));
  chk('el presupuesto por corrida está declarado', /const PRESUPUESTO\s*=\s*5000/.test(src));
  // El envío pasa por api/_correo.js desde 8028208, para que un fallo de Resend
  // quede en el registro en vez de en un console.error que no lee nadie. Lo que
  // importa sigue siendo lo mismo: UNA petición por cada 100, no una por
  // persona.
  chk('usa el endpoint de lote, a través del módulo de correo',
      /enviarResendLote\('cron-campaigns'/.test(src) &&
      /RESEND \+ '\/batch'/.test(readFileSync(new URL('../api/_correo.js', import.meta.url), 'utf8')));
  chk('no queda ninguna actualización fila por fila', !/campaign_recipients\?id=eq/.test(src));
  chk('el índice de WhatsApp se carga fuera del bucle', /async function indiceDeWhatsapp/.test(src));
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  chk('el cron declara su maxDuration', vercel.functions['api/cron-campaigns.js']?.maxDuration >= 60);
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);

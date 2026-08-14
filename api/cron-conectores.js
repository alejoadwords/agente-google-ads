// api/cron-conectores.js
// Avisa cuando un conector deja de recoger leads.
//
// El script vive en una web que no es nuestra. El día que alguien rehace la
// página, cambia el tema de WordPress o quita el plugin del pie, el script
// desaparece y los leads dejan de entrar — sin error, sin aviso, sin nada. El
// contador de la tarjeta lo delata, pero solo si alguien entra a mirarlo.
//
// Corre una vez al día (vercel.json).
export const config = { runtime: 'edge' };

import { emailHtml, pasos, esc } from './_email-layout.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET  = process.env.CRON_SECRET;

const DIA = 86400000;
const SILENCIO_MINIMO = 7;    // días: por debajo de esto no se avisa nunca
const SILENCIO_MAXIMO = 60;   // días: por encima se avisa aunque el ritmo fuera lentísimo
const MULTIPLO = 3;           // veces el ritmo habitual del propio conector

function sb() {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Prefer: 'return=representation',
  };
}

// Cuántos días de silencio son raros PARA ESTE conector. Un formulario que
// recibe un lead al día está roto a los 7; uno que recibe uno al mes, no. Con un
// umbral fijo, o se avisa tarde de los activos o se llena de falsas alarmas con
// los tranquilos.
function umbralDias(c) {
  const desde = new Date(c.created_at || c.last_submission_at).getTime();
  const hasta = new Date(c.last_submission_at).getTime();
  const envios = Math.max(1, c.submissions || 1);
  const ritmoDias = Math.max(1, (hasta - desde) / DIA / envios);
  return Math.min(SILENCIO_MAXIMO, Math.max(SILENCIO_MINIMO, Math.round(ritmoDias * MULTIPLO)));
}

async function correoDelDueno(ownerId) {
  return fetch(`https://api.clerk.com/v1/users/${ownerId}`, {
    headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
  }).then(r => (r.ok ? r.json() : null))
    .then(u => u?.email_addresses?.[0]?.email_address || null)
    .catch(() => null);
}



export default async function handler(req) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
  }

  const limite = new Date(Date.now() - SILENCIO_MINIMO * DIA).toISOString();
  const candidatos = await fetch(
    `${SUPABASE_URL}/rest/v1/lead_forms?tipo=eq.conector&active=is.true&aviso_silencio_at=is.null` +
    `&submissions=gt.0&last_submission_at=lt.${encodeURIComponent(limite)}` +
    `&select=id,user_id,name,origen_url,submissions,created_at,last_submission_at&limit=200`,
    { headers: sb() }
  ).then(r => (r.ok ? r.json() : [])).catch(() => []);

  if (!candidatos.length) return new Response(JSON.stringify({ ok: true, avisados: 0 }));

  const key = process.env.RESEND_API_KEY;
  const correos = new Map();
  let avisados = 0, ignorados = 0;

  for (const c of candidatos) {
    try {
      const dias = Math.floor((Date.now() - new Date(c.last_submission_at).getTime()) / DIA);
      // Todavía dentro de su ritmo normal: no se marca nada, se revisa mañana.
      if (dias < umbralDias(c)) { ignorados++; continue; }

      if (key) {
        if (!correos.has(c.user_id)) correos.set(c.user_id, await correoDelDueno(c.user_id));
        const to = correos.get(c.user_id);
        if (to) {
          const donde = c.origen_url ? esc(c.origen_url.replace(/^https?:\/\//, '')) : 'tu web';
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'Acuarius <crm@app.acuarius.app>',
              to,
              subject: `Tu formulario de ${donde} lleva ${dias} días sin traer leads`,
              html: emailHtml({
                titulo: 'Puede que el código ya no esté en tu web',
                intro: `La conexión <strong>${esc(c.name)}</strong> venía recogiendo leads con regularidad y lleva <strong>${dias} días</strong> sin traer ninguno.`,
                preheader: `${donde} lleva ${dias} días sin traer leads`,
                cuerpo:
                  '<p style="margin:0 0 4px">Suele pasar cuando se rehace la página, se cambia el tema de WordPress o se quita el plugin que insertaba el código en el pie. El script desaparece y los envíos dejan de llegar sin dar ningún error.</p>' +
                  '<p style="margin:16px 0 0;font-weight:700">Qué revisar</p>' +
                  pasos([
                    `Abre ${donde} y busca el script de Acuarius antes de &lt;/body&gt;`,
                    'Si no está, vuelve a pegarlo desde Fuentes → Formularios que ya tienes en tu web',
                    'Envía tu formulario una vez para comprobar que el lead entra',
                  ]),
                cta: { texto: 'Ver mis fuentes', url: 'https://app.acuarius.app/marketing' },
                pie: 'Si el formulario simplemente no ha tenido visitas, ignora este correo: te avisaremos otra vez solo si vuelve a pasar tras recibir leads.',
              }),
            }),
          }).catch(() => {});
        }
      }

      // Se marca aunque no haya salido el correo: sin esto, un fallo de Resend
      // haría que este conector se reintentara cada día para siempre.
      await fetch(`${SUPABASE_URL}/rest/v1/lead_forms?id=eq.${c.id}`, {
        method: 'PATCH', headers: sb(),
        body: JSON.stringify({ aviso_silencio_at: new Date().toISOString() }),
      }).catch(() => {});
      avisados++;
    } catch (e) {
      console.error('cron-conectores', c.id, e?.message);
    }
  }

  return new Response(JSON.stringify({ ok: true, avisados, ignorados, revisados: candidatos.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

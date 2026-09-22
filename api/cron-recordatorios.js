// api/cron-recordatorios.js — «tienes cita mañana» y «tienes cita en dos horas».
//
// Es la pieza que de verdad baja las ausencias. Ninguna automatización del CRM
// servía: todas se disparan por lo que le pasa al LEAD (entró, cambió de etapa,
// lleva días quieto), y esto se dispara por lo cerca que está una cita.
//
// Corre cada 10 minutos. No se busca «las citas que caen justo ahora + 2 h»,
// sino «las que caen dentro de menos de 2 h y todavía no tienen su aviso». La
// diferencia importa: si una ejecución se cae o Vercel se salta un disparo, el
// aviso sale unos minutos tarde en vez de no salir nunca. Lo que se anota es lo
// ENVIADO, en `activities.recordatorios_enviados`, así que nadie recibe dos.
//
// El correo sale en los dos avisos. WhatsApp solo en el último: dos mensajes de
// WhatsApp por una cita es justo lo que hace que la gente bloquee un número.

import { emailHtml, bloque, RESPONDER_A, esc } from './_email-layout.js';
import { abrirConexion } from './_cifrado.js';
import { enviarResend } from './_correo.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

// Cuánto se mira hacia delante. Con el aviso más lejano en 24 h, 26 deja margen
// para una ejecución perdida sin arrastrar la agenda entera.
const VENTANA_H = 26;
const HORAS_VALIDAS = [48, 24, 12, 6, 4, 3, 2, 1];
const POR_DEFECTO = [24, 2];
const TOPE = 400;                 // citas por ejecución; con 10 min de cadencia sobra

function sb(prefer) {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Prefer: prefer || 'return=representation',
  };
}

// Un 5xx de Supabase es casi siempre un tropiezo de su pasarela, no un fallo
// nuestro: el 22-09-2026 hubo un 504 y un 500 en corridas sueltas, con la
// consulta resolviéndose en 0,6 ms contra un índice hecho a medida. Perder la
// corrida entera por eso retrasa los avisos diez minutos y, peor, manda un
// correo de alerta por algo que se arregla solo. Se reintenta una vez.
async function consulta(path, reintentos = 1) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, { headers: sb() });
  if (r.ok) return r.json();
  // Solo los 5xx se reintentan. Un 400 o un 404 no mejoran esperando: son
  // nuestros, y reintentarlos solo tarda el doble en avisar de lo mismo.
  if (r.status >= 500 && reintentos > 0) {
    await new Promise(s => setTimeout(s, 1200));
    return consulta(path, reintentos - 1);
  }
  throw new Error('Supabase ' + r.status);
}

function cuandoTexto(iso, zona) {
  try {
    return new Intl.DateTimeFormat('es-CO', {
      timeZone: zona || 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(new Date(iso));
  } catch { return iso; }
}
function soloHora(iso, zona) {
  try {
    return new Intl.DateTimeFormat('es-CO', {
      timeZone: zona || 'America/Bogota', hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(new Date(iso));
  } catch { return iso; }
}

// ── Los avisos ──────────────────────────────────────────────────────────────

async function porCorreo(neg, cita, lead, horas) {
  if (!RESEND_API_KEY || !lead?.email) return { estado: 'saltado', motivo: 'sin correo' };
  const negocio = neg.nombre_negocio || 'Tu cita';
  const zona = neg.zona_horaria || 'America/Bogota';
  const cuando = cuandoTexto(cita.due_at, zona);
  const enlace = 'https://app.acuarius.app/cita/' + cita.booking_token;

  const html = emailHtml({
    titulo: horas <= 3 ? 'Tu cita es en un rato' : 'Te recordamos tu cita',
    intro: negocio,
    preheader: cuando,
    cuerpo:
      bloque(
        '<b style="font-size:16px">' + esc(cuando) + '</b>' +
        (neg.direccion ? '<br><br>' + esc(neg.direccion) +
          (neg.detalle_direccion ? '<br><span style="color:#5B6072">' + esc(neg.detalle_direccion) + '</span>' : '') : '')
      ) +
      (neg.mensaje_confirmacion ? '<p style="font-size:14px;line-height:1.6">' + esc(neg.mensaje_confirmacion) + '</p>' : '') +
      '<p style="font-size:14px;line-height:1.6;color:#5B6072">Si no puedes venir, cancela desde el botón de abajo ' +
      'para dejarle el turno a alguien más.</p>',
    cta: { texto: 'Ver o cancelar mi cita', url: enlace },
    pie: negocio,
  });

  const r = await enviarResend('cron-recordatorios', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: String(negocio).replace(/[<>"]/g, '').slice(0, 60) + ' <reservas@app.acuarius.app>',
      reply_to: RESPONDER_A,
      to: [lead.email],
      subject: (horas <= 3 ? 'Tu cita es hoy: ' : 'Recordatorio: ') + cuando,
      html,
    }),
  });
  if (!r.ok) return { estado: 'falló', motivo: 'Resend ' + r.status };
  return { estado: 'enviado' };
}

/**
 * El recordatorio por WhatsApp.
 *
 * Meta EXIGE una plantilla aprobada: quien reserva no nos ha escrito, así que
 * no hay ventana de 24 horas que valga. Sin plantilla no se manda nada y no se
 * marca como enviado — el correo, que sí salió, se marca por su cuenta.
 */
async function porWhatsapp(neg, cita, lead, conn) {
  if (!conn || !neg.wa_template?.name) return { estado: 'saltado', motivo: 'sin plantilla' };
  const tel = String(lead?.phone || '').replace(/\D/g, '');
  if (tel.length < 7) return { estado: 'saltado', motivo: 'sin teléfono' };

  const zona = neg.zona_horaria || 'America/Bogota';
  // Los tres huecos van POR POSICIÓN y en este orden. Si algún día cambia la
  // plantilla, hay que cambiarlos aquí a la vez o el cliente recibirá su propio
  // nombre donde debería ir la hora.
  const valores = [
    String(lead?.name || 'Hola').slice(0, 60),
    String(neg.nombre_negocio || 'tu cita').slice(0, 60),
    cuandoTexto(cita.due_at, zona),
  ];

  const res = await fetch(`https://graph.facebook.com/v23.0/${conn.external_id}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${conn.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: tel,
      type: 'template',
      template: {
        name: neg.wa_template.name,
        language: { code: neg.wa_template.language || 'es' },
        components: [{ type: 'body', parameters: valores.map(v => ({ type: 'text', text: v })) }],
      },
    }),
  });
  const d = await res.json().catch(() => ({}));
  if (d.error) {
    // 132xxx son de la plantilla (no existe, no aprobada, parámetros mal):
    // reintentarlos no arregla nada y la cita es dentro de dos horas.
    return { estado: 'falló', motivo: `Meta ${d.error.code}: ${String(d.error.message || '').slice(0, 120)}` };
  }
  return { estado: 'enviado' };
}

// ── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // Vercel firma sus crons; a mano se exige el secreto. Mismo criterio que los
  // demás — dispararlo desde fuera manda mensajes de verdad a gente de verdad.
  const auth = req.headers?.authorization || '';
  const secreto = req.headers?.['x-acuarius-secret'];
  const esCron = auth === `Bearer ${process.env.CRON_SECRET}`;
  if (!esCron && secreto !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const ahora = Date.now();
  const bitacora = [];
  let avisados = 0, fallos = 0;

  try {
    // Las citas vivas de la ventana. `booking_token` distingue una reserva de
    // una reunión que alguien puso a mano en la agenda: a esas no se les avisa.
    const citas = await consulta(
      `/activities?booking_token=not.is.null&cancelled_at=is.null` +
      `&due_at=gte.${encodeURIComponent(new Date(ahora).toISOString())}` +
      `&due_at=lte.${encodeURIComponent(new Date(ahora + VENTANA_H * 3600000).toISOString())}` +
      `&select=id,user_id,client_id,lead_id,due_at,booking_token,recordatorios_enviados` +
      `&order=due_at.asc&limit=${TOPE}`
    );
    if (!citas.length) return res.status(200).json({ ok: true, citas: 0, avisados: 0 });

    // Una sola lectura por cuenta y por lead, no una por cita.
    const cuentas = [...new Set(citas.map(c => c.user_id))];
    const leads = [...new Set(citas.map(c => c.lead_id).filter(Boolean))];

    const [negocios, contactos] = await Promise.all([
      consulta(`/booking_settings?user_id=in.(${cuentas.map(encodeURIComponent).join(',')})&select=*`),
      leads.length
        ? consulta(`/leads?id=in.(${leads.join(',')})&select=id,name,email,phone`)
        : Promise.resolve([]),
    ]);
    const porCuenta = {};
    for (const n of negocios) porCuenta[n.user_id + '|' + (n.client_id || '')] = n;
    const porLead = {};
    for (const l of contactos) porLead[l.id] = l;

    // Las conexiones de WhatsApp, solo de las cuentas que tienen plantilla
    // puesta. Sin esto se leerían y descifrarían tokens que no se van a usar.
    const conWa = negocios.filter(n => n.wa_template?.name).map(n => n.user_id);
    const wa = {};
    if (conWa.length) {
      const conns = await consulta(
        `/channel_connections?user_id=in.(${[...new Set(conWa)].map(encodeURIComponent).join(',')})` +
        // `is_active`, no `status`: esta tabla no tiene columna de estado. Con
        // el nombre equivocado PostgREST devuelve un 42703 que el `.catch` de
        // abajo se tragaba, y WhatsApp no habría salido nunca sin un solo
        // mensaje de error. Lo destapó la prueba, no la lectura.
        `&channel=eq.whatsapp&is_active=is.true&select=user_id,client_id,external_id,access_token`
      ).catch(e => { bitacora.push('no se pudieron leer los canales: ' + (e.message || e)); return null; });
      // Si la lectura falla se ANOTA. Tragársela dejaría sin WhatsApp a todo el
      // mundo sin un solo mensaje, que es exactamente como se pierden meses.
      for (const c of await Promise.all((conns || []).map(abrirConexion))) {
        if (c?.access_token && c?.external_id) wa[c.user_id + '|' + (c.client_id || '')] = c;
      }
      if (conns === null) fallos++;
    }

    for (const cita of citas) {
      const clave = cita.user_id + '|' + (cita.client_id || '');
      const neg = porCuenta[clave] || porCuenta[cita.user_id + '|'];
      if (!neg || !neg.activo) continue;

      const pedidos = Array.isArray(neg.recordatorios) ? neg.recordatorios : POR_DEFECTO;
      const horas = pedidos.map(Number).filter(h => HORAS_VALIDAS.includes(h)).sort((a, b) => b - a);
      if (!horas.length) continue;

      const yaEnviados = Array.isArray(cita.recordatorios_enviados) ? cita.recordatorios_enviados.map(Number) : [];
      const faltanH = ((new Date(cita.due_at).getTime() - ahora) / 3600000);

      // El aviso que toca AHORA es el umbral más cercano ya cruzado. Se calcula
      // antes de mirar lo enviado, y solo después se comprueba si ya salió.
      //
      // Al revés —quedarse con el más cercano de los que FALTAN— a quien ya
      // recibió el de 2 horas se le mandaba luego el de 24, porque «24» seguía
      // sin enviar y 1,5 h también es menos de 24. El cliente recibe dos avisos
      // de la misma cita, el segundo diciendo que es mañana. Lo destapó la
      // prueba de la segunda pasada.
      const candidatos = horas.filter(h => faltanH <= h);
      if (!candidatos.length) continue;
      const h = Math.min(...candidatos);
      if (yaEnviados.includes(h)) continue;

      const lead = cita.lead_id ? porLead[cita.lead_id] : null;
      if (!lead) continue;

      const correo = await porCorreo(neg, cita, lead, h).catch(e => ({ estado: 'falló', motivo: String(e.message || e) }));
      // WhatsApp SOLO en el aviso más cercano de los configurados. Dos mensajes
      // de WhatsApp por una misma cita es como se consigue que bloqueen tu
      // número — y con él, el canal entero del negocio.
      const esElUltimo = h === Math.min(...horas);
      const whats = esElUltimo
        ? await porWhatsapp(neg, cita, lead, wa[clave] || wa[cita.user_id + '|']).catch(e => ({ estado: 'falló', motivo: String(e.message || e) }))
        : { estado: 'saltado', motivo: 'no es el último aviso' };

      // Se marca si SALIÓ ALGO. Si los dos fallaron no se marca: la próxima
      // ejecución lo reintenta, que para eso la ventana mira hacia atrás.
      if (correo.estado === 'enviado' || whats.estado === 'enviado') {
        await fetch(`${SUPABASE_URL}/rest/v1/activities?id=eq.${cita.id}`, {
          method: 'PATCH', headers: sb('return=minimal'),
          body: JSON.stringify({ recordatorios_enviados: [...new Set([...yaEnviados, h])] }),
        }).catch(() => {});
        avisados++;
      } else {
        fallos++;
        bitacora.push(`cita ${cita.id} (${h} h): correo ${correo.motivo || correo.estado}, wa ${whats.motivo || whats.estado}`);
      }
    }

    // Los fallos se cuentan Y se nombran. Un cron que devuelve ok con veinte
    // avisos sin salir es peor que uno que revienta.
    if (fallos) {
      const { registrarError } = await import('./_registro-errores.js');
      await registrarError({
        origen: 'cron',
        donde: 'cron-recordatorios',
        error: new Error(`${fallos} recordatorio(s) sin salir`),
        detalle: bitacora.slice(0, 20).join(' · '),
      }).catch(() => {});
    }
    return res.status(200).json({ ok: true, citas: citas.length, avisados, fallos });
  } catch (e) {
    const { registrarError } = await import('./_registro-errores.js');
    await registrarError({ origen: 'cron', donde: 'cron-recordatorios', error: e }).catch(() => {});
    return res.status(500).json({ error: String(e?.message || e) });
  }
}

// api/_audiencias.js — audiencias del CRM hacia Google y Meta (punto 4)
//
// Un grupo de leads del CRM —los que ya compraron, los que están en proceso,
// los perdidos o los de unas etiquetas— se sube como lista de clientes a la
// red. Para qué: EXCLUIRLOS de las campañas de captación (no pagar por traer
// otra vez a quien ya es cliente o ya está en conversación) o buscar gente
// parecida a los que compraron.
//
// Las dos redes, sus caminos (comprobados el 05-10-2026):
//   · Google: desde el 1-04-2026 Customer Match ya NO se puede usar por la API
//     de Google Ads para quien no lo usaba antes. Va por la Data Manager API,
//     con su propio permiso OAuth (`datamanager`, sensible: Google tiene que
//     verificar la app; mientras tanto el cliente ve el aviso de «app no
//     verificada»). La lista se crea y se llena allí mismo.
//   · Meta: audiencia personalizada de tipo lista de clientes, con
//     `ads_management` (App Review pendiente: hoy solo cuentas con rol en la
//     app) y los términos de audiencias personalizadas aceptados en la cuenta.
//
// Se envía solo la diferencia: quién entró y quién salió del grupo desde el
// último envío (tabla audiencias_miembros). Nunca se envía un dato en claro:
// correo y teléfono normalizados y cifrados con SHA-256, como piden las dos.
//
// SOLO desde funciones edge (regla 2 de CLAUDE.md).

import { sha256, telefonoE164, correoNormal } from './_conversiones.js';
import { conexionDePauta } from './pauta.js';
import { traerTodo } from './_paginado.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = (extra = {}) => ({ 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, ...extra });
async function sb(ruta, init) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, { headers: sbH(), ...(init || {}) });
  if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + (await r.text()).slice(0, 160));
  return r.status === 204 ? null : r.json().catch(() => null);
}

const DM = 'https://datamanager.googleapis.com/v1';
const GRAPH = 'https://graph.facebook.com/v21.0';
export const ESCOPO_GOOGLE = 'https://www.googleapis.com/auth/datamanager';
const LOTE = 5000;          // por petición (Google admite 10.000; Meta recomienda hasta 10.000)
const DURACION = '46656000s';   // 540 días: lo máximo que guarda Google una lista de clientes

export const SEGMENTOS = {
  clientes: 'Clientes que ya compraron',
  en_proceso: 'Leads en proceso',
  perdidos: 'Leads perdidos',
  todos: 'Todos los leads',
  etiquetas: 'Leads con ciertas etiquetas',
};
const GANADAS = ['ganado', 'won'], PERDIDAS = ['perdido', 'lost', 'descartado'];

/** ¿Este lead entra en la audiencia? Pura. */
export function cumpleFiltro(lead, segmento, filtro = {}, ahora = Date.now()) {
  const et = String(lead.stage || '').toLowerCase();
  if (segmento === 'clientes' && !GANADAS.includes(et)) return false;
  if (segmento === 'perdidos' && !PERDIDAS.includes(et)) return false;
  if (segmento === 'en_proceso' && (GANADAS.includes(et) || PERDIDAS.includes(et) || lead.closed_at)) return false;
  if (segmento === 'etiquetas') {
    const quiere = (filtro.etiquetas || []).map(t => String(t).toLowerCase());
    const tiene = (lead.tags || []).map(t => String(t).toLowerCase());
    if (!quiere.length || !quiere.some(t => tiene.includes(t))) return false;
  }
  if (segmento === 'perdidos' && (filtro.motivos || []).length && !filtro.motivos.includes(lead.close_reason)) return false;
  if (filtro.dias && Date.parse(lead.created_at) < ahora - Number(filtro.dias) * 86400000) return false;
  return true;
}

/** Las llaves cifradas de un lead para cada red. null si no tiene ni correo ni teléfono. Pura (salvo el hash). */
export async function llavesDe(lead, red) {
  const correo = correoNormal(lead.email, red === 'google');
  const tel = telefonoE164(lead.phone);
  // Google quiere el teléfono en E.164 con «+»; Meta, solo los dígitos con el código de país.
  const h_email = correo ? await sha256(correo) : null;
  const h_tel = tel ? await sha256(red === 'google' ? '+' + tel : tel) : null;
  return h_email || h_tel ? { h_email, h_tel } : null;
}

/** Quién entra, quién sale y quién cambió de llaves. Pura. */
export function diferencia(actuales, previos) {
  const prev = new Map(previos.map(p => [p.lead_id, p]));
  const entran = [], salen = [];
  for (const a of actuales) {
    const p = prev.get(a.lead_id);
    if (!p) entran.push(a);
    else if (p.h_email !== a.h_email || p.h_tel !== a.h_tel) { salen.push(p); entran.push(a); }
    prev.delete(a.lead_id);
  }
  for (const p of prev.values()) salen.push(p);
  return { entran, salen };
}

const trozos = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

// ── Google (Data Manager API) ───────────────────────────────────────────────
async function tokenGoogle(fila) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: fila.refresh_token, grant_type: 'refresh_token' }),
  });
  const d = await r.json().catch(() => ({}));
  if (!d.access_token) return { error: 'El permiso de Google caducó. Vuelve a conectar la cuenta.' };
  // El permiso de audiencias es aparte: sin él, la Data Manager API responde 403.
  if (!String(d.scope || '').includes('auth/datamanager')) return { error: 'sin_permiso', sinPermiso: true };
  return { token: d.access_token };
}

function cuentaGoogle(fila) {
  const op = { accountType: 'GOOGLE_ADS', accountId: String(fila.account_id || '').replace(/-/g, '') };
  // Si se llega por un administrador, va como cuenta de acceso. Se lee igual
  // que en api/_google-login.js: primero el mapa por cuenta, luego la casilla vieja.
  const extra = fila.extra_data || {};
  const guardado = (extra.login_por_cuenta || {})[op.accountId] ?? (String(fila.account_id || '').replace(/-/g, '') === op.accountId ? extra.login_customer_id : null);
  const login = guardado ? String(guardado).replace(/-/g, '') : null;
  return { operatingAccount: op, ...(login && login !== op.accountId ? { loginAccount: { accountType: 'GOOGLE_ADS', accountId: login } } : {}) };
}

// `login`: la cuenta administradora desde la que se llega. Para las listas
// (userLists) va en la cabecera `login-account`; sin ella, una cuenta que se
// maneja desde un administrador —Certain— responde 403 «no tienes permiso»
// (comprobado el 05-10-2026). En ingest/remove va dentro de `destinations`.
async function dm(token, ruta, cuerpo, metodo = 'POST', login = null) {
  const h = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  if (login) h['login-account'] = 'accountTypes/GOOGLE_ADS/accounts/' + login;
  const r = await fetch(DM + ruta, { method: metodo, headers: h, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  const t = await r.text();
  let d = {}; try { d = JSON.parse(t); } catch {}
  if (!r.ok) {
    const msg = d.error?.message || t.slice(0, 200);
    throw Object.assign(new Error('Google: ' + msg), { status: r.status, raw: msg });
  }
  return d;
}

/** Las listas de la cuenta (solo lectura): para comprobar el acceso. */
export async function listasGoogle(fila) {
  const g = await tokenGoogle(fila); if (g.error) throw Object.assign(new Error(g.error), g);
  const c = cuentaGoogle(fila);
  return (await dm(g.token, `/accountTypes/GOOGLE_ADS/accounts/${c.operatingAccount.accountId}/userLists?pageSize=20`, null, 'GET', c.loginAccount?.accountId || null)).userLists || [];
}

export const redes = {
  google: {
    async crear(fila, nombre) {
      const g = await tokenGoogle(fila); if (g.error) throw Object.assign(new Error(g.error), g);
      const c = cuentaGoogle(fila);
      const d = await dm(g.token, `/accountTypes/GOOGLE_ADS/accounts/${c.operatingAccount.accountId}/userLists`, {
        displayName: nombre.slice(0, 200), description: 'Audiencia del CRM, sincronizada por Acuarius.', membershipDuration: DURACION,
        ingestedUserListInfo: { uploadKeyTypes: ['CONTACT_ID'], contactIdInfo: { dataSourceType: 'DATA_SOURCE_TYPE_FIRST_PARTY' } },
      }, 'POST', c.loginAccount?.accountId || null);
      // El id viene en el nombre del recurso: accountTypes/GOOGLE_ADS/accounts/X/userLists/ID
      return String(d.id || String(d.name || '').split('/').pop());
    },
    async mover(fila, destino, miembros, quitar) {
      const g = await tokenGoogle(fila); if (g.error) throw Object.assign(new Error(g.error), g);
      for (const lote of trozos(miembros, LOTE)) {
        await dm(g.token, quitar ? '/audienceMembers:remove' : '/audienceMembers:ingest', {
          destinations: [{ ...cuentaGoogle(fila), productDestinationId: destino }],
          audienceMembers: lote.map(m => ({ userData: { userIdentifiers: [
            ...(m.h_email ? [{ emailAddress: m.h_email }] : []), ...(m.h_tel ? [{ phoneNumber: m.h_tel }] : []),
          ] } })),
          ...(quitar ? {} : { consent: { adUserData: 'CONSENT_GRANTED', adPersonalization: 'CONSENT_GRANTED' }, termsOfService: { customerMatchTermsOfServiceStatus: 'ACCEPTED' } }),
          encoding: 'HEX',
        });
      }
    },
  },
  meta: {
    async crear(fila, nombre) {
      const act = String(fila.account_id || '').replace(/^act_/, '');
      const r = await fetch(`${GRAPH}/act_${act}/customaudiences`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nombre.slice(0, 200), subtype: 'CUSTOM', customer_file_source: 'USER_PROVIDED_ONLY',
          description: 'Audiencia del CRM, sincronizada por Acuarius.', access_token: fila.access_token }),
      });
      const d = await r.json().catch(() => ({}));
      if (d.error) throw Object.assign(new Error('Meta: ' + (d.error.message || '')), { meta: d.error });
      return String(d.id);
    },
    async mover(fila, destino, miembros, quitar) {
      for (const lote of trozos(miembros, LOTE)) {
        // Cada fila con las dos llaves; la vacía va como cadena vacía.
        const payload = { schema: ['EMAIL_SHA256', 'PHONE_SHA256'], data: lote.map(m => [m.h_email || '', m.h_tel || '']) };
        const r = await fetch(`${GRAPH}/${destino}/users`, {
          method: quitar ? 'DELETE' : 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload, access_token: fila.access_token }),
        });
        const d = await r.json().catch(() => ({}));
        if (d.error) throw Object.assign(new Error('Meta: ' + (d.error.message || '')), { meta: d.error });
      }
    },
  },
};

/** Un error de la red, dicho para la persona que lo va a leer. Pura. */
export function errorLegible(e, red) {
  const m = String(e?.raw || e?.message || e || '');
  if (e?.sinPermiso) return 'Falta el permiso de audiencias de Google. Pulsa «Dar permiso en Google» y acepta la casilla de audiencias.';
  if (red === 'google' && /has not been used|is disabled|SERVICE_DISABLED/i.test(m)) return 'La API de audiencias de Google no está activada en el proyecto de Acuarius. Ya lo sabemos: escríbenos a soporte.';
  if (red === 'google' && /terms|TERMS_OF_SERVICE|customer match/i.test(m) && /not|accept/i.test(m)) return 'La cuenta de Google Ads no tiene aceptadas las condiciones de Customer Match. Acéptalas en Google Ads → Herramientas → Administrador de públicos.';
  if (red === 'google' && /policy|not eligible|ineligible|POLICY/i.test(m)) return 'Google no deja usar listas de clientes en esta cuenta todavía (pide buen historial de pagos y de políticas). ' + m.slice(0, 120);
  if (red === 'meta' && (e?.meta?.error_subcode === 1870034 || /terms of service|tos/i.test(m))) return 'Hay que aceptar los términos de audiencias personalizadas de Meta en la cuenta publicitaria: business.facebook.com/ads/manage/customaudiences/tos';
  if (red === 'meta' && (e?.meta?.code === 200 || e?.meta?.code === 10 || /permission/i.test(m))) return 'Meta no da permiso para crear audiencias desde Acuarius todavía (falta la revisión de la app de Meta).';
  return m.slice(0, 240) || 'La red no aceptó la audiencia.';
}

/** Los leads del grupo, con sus llaves para la red. */
async function miembrosActuales(aud) {
  let ruta = `${SUPABASE_URL}/rest/v1/leads?user_id=eq.${encodeURIComponent(aud.user_id)}&deleted_at=is.null` +
    `&or=(email.not.is.null,phone.not.is.null)&select=id,email,phone,stage,tags,close_reason,closed_at,created_at&order=created_at.desc`;
  if (aud.client_id) ruta += `&client_id=eq.${encodeURIComponent(aud.client_id)}`;
  const { filas } = await traerTodo(ruta, sbH(), { techo: 100000 });
  const out = [];
  for (const l of filas) {
    if (!cumpleFiltro(l, aud.segmento, aud.filtro || {})) continue;
    const k = await llavesDe(l, aud.red);
    if (k) out.push({ lead_id: l.id, ...k });
  }
  return out;
}

/**
 * Sincroniza una audiencia: la crea en la red si hace falta, sube a los que
 * entraron, saca a los que salieron y lo deja anotado. Nunca lanza: el error
 * queda en la fila, dicho para quien lo va a leer.
 */
export async function sincronizar(aud) {
  const marcar = (c) => sb(`/audiencias_crm?id=eq.${aud.id}`, { method: 'PATCH', headers: sbH({ Prefer: 'return=minimal' }), body: JSON.stringify({ ...c, updated_at: new Date().toISOString() }) }).catch(() => {});
  try {
    const fila = await conexionDePauta(aud.user_id, aud.conexion_id);
    if (!fila || !fila.account_id) { await marcar({ error: 'La cuenta publicitaria de esta audiencia ya no está conectada.' }); return { error: true }; }
    const red = redes[aud.red];
    let destino = aud.destino_id;
    if (!destino) {
      destino = await red.crear(fila, aud.nombre);
      await marcar({ destino_id: destino });
    }
    const actuales = await miembrosActuales(aud);
    const previos = await sb(`/audiencias_miembros?audiencia_id=eq.${aud.id}&select=lead_id,h_email,h_tel`) || [];
    const { entran, salen } = diferencia(actuales, previos);
    if (salen.length) {
      await red.mover(fila, destino, salen, true);
      for (const lote of trozos(salen.map(s => s.lead_id), 200)) {
        await sb(`/audiencias_miembros?audiencia_id=eq.${aud.id}&lead_id=in.(${lote.join(',')})`, { method: 'DELETE' });
      }
    }
    if (entran.length) {
      await red.mover(fila, destino, entran, false);
      for (const lote of trozos(entran, 500)) {
        await sb('/audiencias_miembros?on_conflict=audiencia_id,lead_id', {
          method: 'POST', headers: sbH({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
          body: JSON.stringify(lote.map(m => ({ audiencia_id: aud.id, lead_id: m.lead_id, h_email: m.h_email, h_tel: m.h_tel }))),
        });
      }
    }
    await marcar({ miembros: actuales.length, ultimo_sync: new Date().toISOString(), error: null });
    return { ok: true, miembros: actuales.length, entran: entran.length, salen: salen.length };
  } catch (e) {
    console.error('[audiencias]', aud.id, e?.message);
    await marcar({ error: errorLegible(e, aud.red) });
    return { error: true, mensaje: errorLegible(e, aud.red) };
  }
}

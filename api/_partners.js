// api/_partners.js — programa de Partners: comisiones sobre las licencias que traen
//
// Reglas (decididas por Alejandro el 06-10-2026):
//   · Se postulan y Acuarius aprueba. Solo un Partner APROBADO acumula.
//   · Una cuenta que llegó por su enlace /registro/<slug> es suya para siempre.
//   · Gana su % (20 por defecto) de la LICENCIA completa de la cuenta —el plan
//     Pro o Agency más sus usuarios y contactos adicionales—, mensual o anual,
//     mientras siga pagando (ampliado a usuarios y contactos el 06-10-2026).
//     SMS, mensajes del agente y créditos de video NO comisionan: tienen costo
//     directo para nosotros. Qué cuenta lo dice CONCEPTOS_COMISIONABLES.
//   · Sobre lo cobrado de verdad, convertido a USD si se pagó en otra moneda.
//   · Un reembolso o contracargo descuenta lo que ese cobro generó.
//   · Se liquida una vez al mes: el Partner elige comisiones y sube su factura.
//
// La fuente es la tabla `cobros` (la llena api/hotmart-webhook.js; Stripe hará
// lo mismo). Este módulo solo se importa desde funciones edge.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = (extra = {}) => ({ 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, ...extra });

export async function sb(ruta, init) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, { headers: sbH(init?.prefer ? { Prefer: init.prefer } : {}), ...(init || {}) });
  if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + (await r.text()).slice(0, 200));
  return r.status === 204 ? null : r.json().catch(() => null);
}
export { sbH };

export const PCT_POR_DEFECTO = 20;
export const ESTADOS_PARTNER = ['postulado', 'aprobado', 'rechazado', 'pausado'];

// ── Cálculos puros (probados en pruebas/partners.mjs) ───────────────────────

const r2 = n => Math.round(Number(n) * 100) / 100;

/**
 * La comisión de un cobro. `tasa` = unidades de la moneda por 1 USD (1 para
 * USD). Un reembolso o contracargo da una comisión NEGATIVA del mismo tamaño.
 */
export function comisionDe(cobro, pct, tasa) {
  if (!(tasa > 0)) throw new Error('sin tasa de cambio para ' + cobro.moneda);
  const base = r2(Number(cobro.monto) / tasa);
  const signo = cobro.tipo === 'cobro' ? 1 : -1;
  return { base_usd: signo * base, comision_usd: signo * r2(base * Number(pct) / 100) };
}

/** Lo que una cuenta aporta al mes en USD, a partir de su último cobro. */
/**
 * Qué conceptos de `cobros.plan` generan comisión. Es la regla para TODAS las
 * pasarelas: Hotmart anota cada producto por separado; Stripe, cuando llegue,
 * debe anotar cada línea de licencia de la factura con uno de estos valores
 * (o el plan con el total de esas líneas) y dejar fuera SMS y mensajes IA.
 */
export const CONCEPTOS_COMISIONABLES = ['pro', 'agency', 'usuarios', 'contactos'];
export const esComisionable = (concepto) => CONCEPTOS_COMISIONABLES.includes(concepto);

/**
 * Lo que una cuenta aporta al mes: el último cobro de cada concepto (el plan,
 * los usuarios, los contactos) llevado a mensual. `cobros` de UNA cuenta,
 * del más reciente al más antiguo.
 */
export function mrrDe(cobros, tasas) {
  const visto = new Set();
  let total = 0;
  for (const c of cobros || []) {
    if (c.tipo && c.tipo !== 'cobro') continue;
    if (!esComisionable(c.plan)) continue;
    const grupo = (c.plan === 'pro' || c.plan === 'agency') ? 'plan' : c.plan;
    if (visto.has(grupo)) continue;
    visto.add(grupo);
    total += mensualDe(c, tasas[c.moneda]);
  }
  return r2(total);
}

export function mensualDe(cobro, tasa) {
  if (!cobro || !(tasa > 0)) return 0;
  const usd = Number(cobro.monto) / tasa;
  return r2(cobro.periodo === 'anual' ? usd / 12 : usd);
}

/**
 * Qué comisiones entran en una liquidación. El Partner elige las positivas;
 * las negativas disponibles (reembolsos de algo ya cobrado) entran SIEMPRE,
 * para que no se pueda dejar fuera un descuento. Si el total no es positivo,
 * no hay nada que liquidar.
 */
export function armarLiquidacion(disponibles, elegidas) {
  const set = new Set((elegidas || []).map(String));
  const dentro = disponibles.filter(c => Number(c.comision_usd) < 0 || set.has(String(c.id)));
  const ajenas = [...set].filter(id => !disponibles.some(c => String(c.id) === id));
  const total = r2(dentro.reduce((s, c) => s + Number(c.comision_usd), 0));
  return { dentro, total, ajenas };
}

/** Estado de una cuenta referida según su plan en Clerk. */
export function estadoCuenta(meta) {
  const plan = meta?.plan || 'free';
  if (plan === 'pro' || plan === 'agency') return 'activa';
  if (plan === 'trial') return (meta.trial_until && Date.parse(meta.trial_until) > Date.now()) ? 'prueba' : 'desactivada';
  return 'desactivada';
}

export function slugDesde(texto) {
  return String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
}

// ── Tasa de cambio ──────────────────────────────────────────────────────────

let _tasas = null, _tasasAt = 0;
/**
 * Unidades de `moneda` por 1 USD. USD = 1. Sin tasa NO se calcula a ojo: el
 * cobro se queda sin comisión y se reintenta en la siguiente vuelta del cron.
 */
export async function tasaUSD(moneda) {
  const m = String(moneda || 'USD').toUpperCase();
  if (m === 'USD') return 1;
  if (!_tasas || Date.now() - _tasasAt > 3600e3) {
    const r = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(8000) });
    const d = await r.json().catch(() => null);
    if (d?.result !== 'success' || !d.rates) throw new Error('no se pudo leer la tasa de cambio');
    _tasas = d.rates; _tasasAt = Date.now();
  }
  const t = Number(_tasas[m]);
  if (!(t > 0)) throw new Error('no hay tasa de cambio para ' + m);
  return t;
}

// ── Acumular comisiones (cron-partners) ──────────────────────────────────────

/**
 * Convierte en comisiones los cobros de cuentas referidas que aún no la tienen.
 * Idempotente: `cobro_id` es único en partner_comisiones.
 */
export async function acumular() {
  const partners = await sb('/partners?estado=eq.aprobado&select=user_id,comision_pct') || [];
  if (!partners.length) return { nuevas: 0, sinTasa: 0 };
  const pct = Object.fromEntries(partners.map(p => [p.user_id, Number(p.comision_pct) || PCT_POR_DEFECTO]));
  const referidos = (await sb(`/partner_referidos?partner_user_id=in.(${partners.map(p => encodeURIComponent(p.user_id)).join(',')})&select=referido_user_id,partner_user_id,correo,creado_at`) || []);
  if (!referidos.length) return { nuevas: 0, sinTasa: 0 };
  const porUsuario = Object.fromEntries(referidos.map(r => [r.referido_user_id, r]));
  const porCorreo = Object.fromEntries(referidos.filter(r => r.correo).map(r => [r.correo.toLowerCase(), r]));

  // Cobros de esas cuentas (por id de Clerk o, si el webhook no lo encontró,
  // por correo). De a 100 para no pasarse del largo de la URL.
  const cobros = [];
  const ids = Object.keys(porUsuario), correos = Object.keys(porCorreo);
  for (let i = 0; i < ids.length; i += 100) {
    cobros.push(...(await sb(`/cobros?user_id=in.(${ids.slice(i, i + 100).map(encodeURIComponent).join(',')})&select=*&order=id.asc`) || []));
  }
  for (let i = 0; i < correos.length; i += 60) {
    const lote = correos.slice(i, i + 60).map(c => '"' + c.replace(/"/g, '') + '"').map(encodeURIComponent).join(',');
    cobros.push(...(await sb(`/cobros?user_id=is.null&correo=in.(${lote})&select=*&order=id.asc`) || []));
  }
  if (!cobros.length) return { nuevas: 0, sinTasa: 0 };

  const hechas = new Set((await sb(`/partner_comisiones?cobro_id=in.(${cobros.map(c => c.id).join(',')})&select=cobro_id`) || []).map(c => c.cobro_id));
  let nuevas = 0, sinTasa = 0;
  for (const c of cobros.sort((a, b) => a.id - b.id)) {
    if (hechas.has(c.id)) continue;
    const ref = porUsuario[c.user_id] || porCorreo[(c.correo || '').toLowerCase()];
    if (!ref) continue;
    if (!esComisionable(c.plan)) continue;
    // Solo lo cobrado DESPUÉS de llegar por el enlace.
    if (Date.parse(c.cobrado_at) < Date.parse(ref.creado_at) - 86400e3) continue;
    let tasa;
    try { tasa = await tasaUSD(c.moneda); } catch { sinTasa++; continue; }

    let estado = 'disponible';
    if (c.tipo !== 'cobro') {
      // Reverso: si el cobro original no generó comisión, no hay nada que
      // descontar. Si la generó y sigue sin liquidar, se anulan los dos y no
      // aparecen; si ya se liquidó, el negativo queda disponible y se descuenta
      // en la próxima liquidación.
      const [orig] = await sb(`/cobros?pasarela=eq.${encodeURIComponent(c.pasarela)}&transaccion=eq.${encodeURIComponent(c.transaccion)}&tipo=eq.cobro&select=id`) || [];
      const [comOrig] = orig ? (await sb(`/partner_comisiones?cobro_id=eq.${orig.id}&select=id,estado`) || []) : [];
      if (!comOrig) continue;
      if (comOrig.estado === 'disponible') {
        await sb(`/partner_comisiones?id=eq.${comOrig.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ estado: 'anulada' }) });
        estado = 'anulada';
      }
    }
    const p = pct[ref.partner_user_id];
    const { base_usd, comision_usd } = comisionDe(c, p, tasa);
    await sb('/partner_comisiones?on_conflict=cobro_id', {
      method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal',
      body: JSON.stringify({
        partner_user_id: ref.partner_user_id, referido_user_id: ref.referido_user_id, cobro_id: c.id,
        tipo: c.tipo, plan: c.plan, monto_cobrado: c.monto, moneda: c.moneda, tasa_usd: tasa,
        base_usd, pct: p, comision_usd, estado, cobrado_at: c.cobrado_at,
      }),
    });
    nuevas++;
  }
  return { nuevas, sinTasa };
}

// ── Clerk ───────────────────────────────────────────────────────────────────

const CLERK = 'https://api.clerk.com/v1';
const clerkH = () => ({ Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`, 'Content-Type': 'application/json' });

export async function clerkUsuario(id) {
  const r = await fetch(`${CLERK}/users/${encodeURIComponent(id)}`, { headers: clerkH() });
  if (!r.ok) throw new Error('Clerk ' + r.status);
  return r.json();
}

/** Varios usuarios de Clerk por id, de a 100. Los que no existan, no vienen. */
export async function clerkUsuarios(ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 100) {
    const q = ids.slice(i, i + 100).map(id => 'user_id=' + encodeURIComponent(id)).join('&');
    const r = await fetch(`${CLERK}/users?${q}&limit=100`, { headers: clerkH() });
    if (!r.ok) throw new Error('Clerk ' + r.status);
    for (const u of await r.json()) out[u.id] = u;
  }
  return out;
}

export function correoPrincipal(u) {
  if (!u) return '';
  const p = (u.email_addresses || []).find(e => e.id === u.primary_email_address_id) || (u.email_addresses || [])[0];
  return (p?.email_address || '').toLowerCase();
}
export function nombreDe(u) {
  return [u?.first_name, u?.last_name].filter(Boolean).join(' ').trim();
}
export function admins() {
  return String(process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

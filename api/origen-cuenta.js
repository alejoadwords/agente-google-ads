// api/origen-cuenta.js — de dónde llegó una cuenta nueva de Acuarius.
//
//   POST (con sesión)   lee la cookie acu_origen (public/origen.js, compartida
//                       por *.acuarius.app), la clasifica y la guarda en
//                       cuentas_origen. Una vez por cuenta, y solo si la cuenta
//                       tiene menos de 3 días: una cuenta vieja que entra hoy
//                       desde Google no «llegó» desde Google.
//
// Lo llama app.js al primer ingreso. Si falta la cookie (otro navegador,
// cookies bloqueadas) se guarda como Directo / sin información: también es un dato.
export const config = { runtime: 'edge' };

import { verificarSesion, cuerpoSinSesion } from './_sesion.js';
import { clasificarOrigen } from './_origen.js';
import { registrarError } from './_registro-errores.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });
const DIAS_CUENTA_NUEVA = 3;

// La cookie, tal como la escribe public/origen.js → { params, ref, url, t }.
export function leerCookieOrigen(cabecera) {
  const m = String(cabecera || '').split(/;\s*/).find(c => c.startsWith('acu_origen='));
  if (!m) return null;
  try {
    const o = JSON.parse(decodeURIComponent(m.slice('acu_origen='.length)));
    return { params: o.p || {}, ref: o.r || '', url: o.u || '', t: Number(o.t) || null };
  } catch { return null; }
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  const sesion = await verificarSesion(req);
  if (!sesion.id) return json(await cuerpoSinSesion(sesion, 'origen-cuenta'), 401);
  try {
    const u = await fetch('https://api.clerk.com/v1/users/' + encodeURIComponent(sesion.id), { headers: { Authorization: 'Bearer ' + process.env.CLERK_SECRET_KEY } })
      .then(r => (r.ok ? r.json() : null)).catch(() => null);
    if (!u?.created_at) return json({ ok: false, motivo: 'no se pudo leer la cuenta' }, 503);
    if (Date.now() - u.created_at > DIAS_CUENTA_NUEVA * 86400000) return json({ ok: true, omitido: 'cuenta antigua' });
    const o = leerCookieOrigen(req.headers.get('cookie'));
    const c = o ? clasificarOrigen(o, 'acuarius.app') : { canal: 'Directo', origen: 'Sin información (sin cookie)', pagina: null, referente: null };
    let sitio = null;
    try { sitio = o?.url ? new URL(o.url).hostname.replace(/^www\./, '') : null; } catch {}
    const r = await fetch(`${SUPABASE_URL}/rest/v1/cuentas_origen?on_conflict=user_id`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({ user_id: sesion.id, canal: c.canal, origen: c.origen, pagina: c.pagina, referente: c.referente, sitio,
        params: o?.params && Object.keys(o.params).length ? o.params : null, visita_at: o?.t ? new Date(o.t).toISOString() : null }),
    });
    if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + (await r.text()).slice(0, 200));
    return json({ ok: true, canal: c.canal });
  } catch (e) {
    await registrarError({ origen: 'servidor', donde: 'origen-cuenta', error: e, usuario: sesion.id }).catch(() => {});
    return json({ ok: false }, 500);
  }
}

// pruebas/traspaso-lleva-las-notas.mjs
//
// Al quitar a un asesor se le pasa la cartera a otro. Las notas que la
// dirección le dejó y no ha abierto tienen que ir con ella: la campana que las
// enseña filtra por `metadata->>para`, así que una nota dirigida a quien ya no
// entra no la ve nadie nunca más. En Certain quedaron diez así entre el 15 y
// el 17-09-2026 y solo aparecieron mirando la base a mano.
//
// Se ejecuta `traspasar()` con Supabase simulado y se mira qué notas se
// redirigen: las de los leads que cambiaron de manos sí, las de un lead que no
// se movió no —esa no es asunto del responsable nuevo—.

import { readFileSync } from 'node:fs';

process.env.SUPABASE_URL = 'https://ejemplo.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'llave';

const CUENTA = 'user_dueno', SE_VA = 'user_asesora', DESTINO = 'user_nueva';

// Dos leads cambian de manos; el tercero es de otra persona y no se mueve.
const NOTAS = [
  { id: 'n1', lead_id: 'lead_a', metadata: { para: SE_VA, texto: 'llamar hoy' } },
  { id: 'n2', lead_id: 'lead_b', metadata: { para: SE_VA } },
  { id: 'n3', lead_id: 'lead_ajeno', metadata: { para: SE_VA } },
];

const parcheadas = {};
let pidioNotasDe = null;

globalThis.fetch = async (url, opt = {}) => {
  const u = String(url), m = opt.method || 'GET';
  const ok = (b) => new Response(JSON.stringify(b), { status: 200 });

  if (u.includes('/leads?') && m === 'PATCH') return ok([{ id: 'lead_a' }, { id: 'lead_b' }]);
  if (u.includes('/lead_forms?') && m === 'PATCH') return ok([]);
  if (u.includes('/lead_forms?')) return ok([]);
  if (u.includes('/user_profiles?')) return ok([]);
  if (u.includes('/team_members?')) return ok([{ member_name: 'Nueva' }]);

  if (u.includes('/lead_activities?') && m === 'GET') {
    pidioNotasDe = u;
    // Se responde como respondería PostgREST al filtro `lead_id=in.(…)`.
    const dentro = decodeURIComponent(u.split('lead_id=in.(')[1] || '').split(')')[0].split(',');
    return ok(NOTAS.filter(n => dentro.includes(n.lead_id)));
  }
  if (u.includes('/lead_activities?id=eq.') && m === 'PATCH') {
    parcheadas[u.split('id=eq.')[1]] = JSON.parse(opt.body).metadata;
    return ok({});
  }
  return ok([]);
};

// `traspasar` no se exporta: es interna del endpoint. Se extrae del fichero y
// se ejecuta con las ayudantes que necesita simuladas.
const src = readFileSync(new URL('../api/team.js', import.meta.url), 'utf8');
const cuerpo = src.slice(src.indexOf('async function traspasar('));
const fin = cuerpo.indexOf('\n}\n');
const codigo = cuerpo.slice(0, fin + 2);

const SUPABASE_URL = process.env.SUPABASE_URL;
const sbHeaders = () => ({ apikey: 'x', Authorization: 'Bearer x' });
const nombreDe = async () => 'Nueva';
const reglaNombra = () => false;
const reglaCambiada = (r) => r;

const traspasar = new Function('SUPABASE_URL', 'sbHeaders', 'nombreDe', 'reglaNombra', 'reglaCambiada',
  codigo + '; return traspasar;')(SUPABASE_URL, sbHeaders, nombreDe, reglaNombra, reglaCambiada);

const movido = await traspasar(CUENTA, SE_VA, DESTINO);

let mal = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) mal++; };

ok(movido.leads === 2, 'se mueven los 2 leads');
ok(movido.notas === 2, 'y las 2 notas de esos leads: ' + movido.notas);
ok(parcheadas.n1?.para === DESTINO, 'la nota del primer lead apunta al responsable nuevo');
ok(parcheadas.n1?.texto === 'llamar hoy', 'sin perder lo que ya traía en metadata');
ok(parcheadas.n1?.redirigida_de === SE_VA, 'y queda escrito de quién venía');
ok(!parcheadas.n3, 'la nota de un lead que NO se movió se queda donde estaba');
ok(/leida_at=is\.null/.test(pidioNotasDe || ''), 'solo se tocan las que nadie ha abierto');
ok(!/lead_ajeno/.test(pidioNotasDe || ''), 'ni siquiera se pregunta por leads ajenos');

process.exit(mal ? 1 : 0);

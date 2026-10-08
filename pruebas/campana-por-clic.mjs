// pruebas/campana-por-clic.mjs
//
// Una nota de la campana solo sale cuando la persona le da clic y abre su lead
// —en la web y en el móvil—. Antes se borraban TODAS con solo abrir la campana
// (web) o con un «Marcar como leídos» (móvil), y una nota que no se alcanzó a
// leer desaparecía para siempre.
//
// Lo que se protege:
//   1. Abrir la campana no marca nada.
//   2. Clic en una nota marca ESA y ninguna otra, y solo si el lead se abrió.
//   3. El servidor rechaza el marcado en bloque (también de pestañas viejas).
//   4. Si el servidor falla, la nota vuelve a la campana y se dice.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(join(RAIZ, 'public/app.js'), 'utf8');
const movil = readFileSync(join(RAIZ, 'public/movil-app.js'), 'utf8');
const api = readFileSync(join(RAIZ, 'api/lead-activities.js'), 'utf8');

let mal = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) mal++; };
const cuerpo = (src, firma) => {
  const i = src.indexOf(firma);
  return i < 0 ? '' : src.slice(i, src.indexOf('\n}\n', i) + 2);
};

console.log('\nAbrir la campana no marca nada\n');
const panel = cuerpo(app, 'function crmAvisosPanel(');
ok(panel && !/crmAvisosMarcarLeidos|crmAvisoMarcarLeido\(/.test(panel), 'la web pinta las notas sin marcarlas');
ok(!/function crmAvisosMarcarLeidos/.test(app), 'ya no existe el «marcar todas»');
ok(!/leerAvisos|Marcar como leídos/.test(movil), 'el móvil ya no tiene botón de marcar todos');

console.log('\nClic en una nota marca esa, y solo si su lead abrió\n');
ok(/crmAvisoAbrir\(\\'' \+ esc\(a\.id\) \+ '\\',\\'' \+ esc\(a\.lead_id\)/.test(panel), 'cada nota de la web lleva su id');
ok(/if \(await crmIrALeadODecirlo\(leadId\)\) crmAvisoMarcarLeido\(avisoId\)/.test(app), 'la web marca solo si el lead se abrió');
{
  // Una nota de un lead de OTRO PROCESO del mismo cliente no es «de otro
  // cliente»: se cambia de tablero y se abre (Certain, 08-10-2026).
  const ir = (app.match(/async function crmIrALeadODecirlo[\s\S]*?\n}\n/) || [''])[0];
  ok(/fetchAuth\('\/api\/leads\?id='/.test(ir), 'si no está en el tablero, pregunta por el lead');
  ok(/pipeCambiar\(proceso\.id\)/.test(ir), 'y cambia al tablero donde está');
  ok(ir.indexOf('lead.client_id !== clienteActivo') > 0 && ir.indexOf('lead.client_id !== clienteActivo') < ir.indexOf('pertenece a otro cliente'), '«otro cliente» solo si de verdad es de otro cliente');
  ok(/!crmLeadsLoaded/.test(ir), 'espera a que carguen los leads antes de buscar');
}
const abrirAviso = cuerpo(movil, 'async function abrirAviso(');
ok(/M\.abrirAviso\(/.test(movil) && /abrirAviso: abrirAviso/.test(movil), 'cada aviso del móvil se toca');
ok(abrirAviso.indexOf('if (!esta)') > -1 && abrirAviso.indexOf('if (!esta)') < abrirAviso.indexOf('crmAvisoMarcarLeido(avisoId)'),
   'el móvil no marca un aviso cuyo lead no está en su lista');

// El marcado de verdad, ejecutado.
const marcar = cuerpo(app, 'async function crmAvisoMarcarLeido(');
async function correr(respuesta) {
  const llamadas = [], toasts = [];
  const f = new Function('estado', 'fetchAuth', 'showToast', `
    let crmAvisos = estado.avisos, crmAvisosPorLead = {}, _avisosVistos = null;
    const refrescarCampana = () => {};
    ${marcar}
    return crmAvisoMarcarLeido(estado.id).then(r => ({ r, crmAvisos, _avisosVistos }));
  `);
  const fetchAuth = async (url, o) => { llamadas.push({ url, o }); return respuesta(); };
  const avisos = [{ id: 'a1', lead_id: 'L1' }, { id: 'a2', lead_id: 'L2' }, { id: 'a3', lead_id: 'L1' }];
  const out = await f({ avisos, id: 'a2' }, fetchAuth, (t, k) => toasts.push(k));
  return { ...out, llamadas, toasts };
}
{
  const o = await correr(() => ({ ok: true, json: async () => ({ marcadas: 1 }) }));
  ok(o.r === true && o.crmAvisos.map(a => a.id).join() === 'a1,a3', 'sale solo la nota que se abrió');
  ok(o.llamadas.length === 1 && /avisos=1&id=a2$/.test(o.llamadas[0].url) && o.llamadas[0].o.method === 'PATCH', 'y se pide marcar esa por su id');
  ok(o._avisosVistos === 2, 'bajar el contador no suena como «llegó algo»');
}
{
  const o = await correr(() => ({ ok: false, status: 500, json: async () => ({ error: 'x' }) }));
  ok(o.r === false && o.crmAvisos.length === 3, 'si el servidor falla, la nota vuelve a la campana');
  ok(o.toasts.includes('error'), 'y se dice');
}

console.log('\nEl servidor no marca en bloque\n');
const patch = api.slice(api.indexOf("if (req.method === 'PATCH' && url.searchParams.get('avisos') === '1')"));
const bloque = patch.slice(0, patch.indexOf('return jsonResp({ marcadas: 1 });'));
ok(/las notas se marcan una por una\.' \}, 400\)/.test(bloque), 'sin id responde 400');
ok(/\?id=eq\.\$\{encodeURIComponent\(id\)\}/.test(bloque) && /metadata->>para=eq\.\$\{encodeURIComponent\(actorId\)\}/.test(bloque),
   'marca esa nota y solo si es para quien la pide');
ok(/\.\.\.\(f\.metadata \|\| \{\}\), leida_at/.test(bloque), 'conserva el resto de la metadata');
ok(!/for \(const f of filas\)/.test(bloque), 'ya no recorre todas las sin leer');

console.log(mal ? `\n${mal} fallo(s)\n` : '\nTodo en orden\n');
process.exit(mal ? 1 : 0);

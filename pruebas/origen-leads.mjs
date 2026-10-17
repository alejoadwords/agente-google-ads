// De dónde vino un lead web: node pruebas/origen-leads.mjs
//
// El clasificador (api/_origen.js), que el conector y las landings lo manden
// siempre, y que el reporte SEO cuente leads y ventas por canal sin datos
// personales.
import { readFileSync } from 'fs';
import { clasificarOrigen, camposDeOrigen, origenDelCuerpo } from '../api/_origen.js';

let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); if (!c) mal++; };
const c = (params, ref, url = 'https://acuarius.app/precios?x=1') => clasificarOrigen({ params, ref, url });

console.log('\nBuscadores e IAs (lo que antes se perdía)');
ok(c({}, 'https://www.google.com/').canal === 'Buscadores' && c({}, 'https://www.google.com.co/').origen === 'Google', 'Google (cualquier país) → Buscadores');
ok(c({}, 'https://www.bing.com/search?q=crm').origen === 'Bing' && c({}, 'https://duckduckgo.com/').origen === 'DuckDuckGo', 'Bing, DuckDuckGo');
ok(c({}, 'https://chatgpt.com/').canal === 'IA' && c({}, 'https://chatgpt.com/').origen === 'ChatGPT', 'ChatGPT → IA');
ok(c({}, 'https://www.perplexity.ai/search/x').origen === 'Perplexity' && c({}, 'https://gemini.google.com/app').origen === 'Gemini' && c({}, 'https://claude.ai/').origen === 'Claude', 'Perplexity, Gemini (no es «Google buscador»), Claude');
ok(c({ utm_source: 'chatgpt.com' }, '').canal === 'IA', 'utm_source=chatgpt.com (lo que agrega ChatGPT) → IA');
ok(c({}, 'https://mail.google.com/').canal === 'Correo', 'Gmail no es el buscador de Google');

console.log('\nAnuncios');
ok(c({ gclid: 'abc', utm_campaign: 'Marca' }, 'https://www.google.com/').canal === 'Google Ads', 'gclid → Google Ads aunque venga de google.com');
ok(c({ utm_source: 'adwords', utm_medium: 'cpc' }, '').canal === 'Google Ads', 'utm_source=adwords + cpc → Google Ads (caso Certain)');
ok(c({ fbclid: 'x', utm_source: 'fb', utm_medium: 'paid' }, 'https://l.facebook.com/').canal === 'Meta Ads', 'fbclid + utm pagada → Meta Ads');
ok(c({ fbclid: 'x' }, 'https://l.facebook.com/').canal === 'Redes sociales', 'fbclid SOLO no es anuncio: Facebook lo pone en todo enlace');
ok(c({ ttclid: 'x' }, '').canal === 'TikTok Ads' && c({ msclkid: 'x' }, '').canal === 'Microsoft Ads', 'TikTok y Microsoft Ads');

console.log('\nRedes, correo, otros, directo');
ok(c({}, 'https://l.instagram.com/').origen === 'Instagram' && c({}, 'https://t.co/abc').origen === 'X', 'Instagram, X');
ok(c({ utm_source: 'newsletter', utm_medium: 'email' }, '').canal === 'Correo', 'utm de correo → Correo');
ok(c({}, 'https://blog.otro.com/articulo').canal === 'Otro sitio' && c({}, 'https://blog.otro.com/articulo').referente === 'blog.otro.com', 'otro sitio, con su dominio');
ok(c({}, '').canal === 'Directo' && c({}, 'https://acuarius.app/inicio').canal === 'Directo', 'sin referente (o desde el mismo sitio) → Directo');
ok(c({}, 'https://app.acuarius.app/x', 'https://acuarius.app/').canal === 'Directo', 'un subdominio del mismo sitio no es un origen');

console.log('\nLo que se guarda en el lead');
const cf = camposDeOrigen({ params: {}, ref: 'https://www.google.com/', url: 'https://www.acuarius.app/precios?x=1' });
ok(cf['Canal de origen'] === 'Buscadores' && cf['Origen'] === 'Google' && cf['Página de entrada'] === '/precios' && cf['Sitio'] === 'acuarius.app', 'canal, origen, página de entrada y sitio', cf);
ok(Object.keys(camposDeOrigen({ params: {} })).length === 0, 'sin ningún dato, no inventa «Directo»');
const ob = origenDelCuerpo({ _origen: { _url: 'https://x.com/a', _ref: 'https://chatgpt.com/', gclid: '', utm_source: 'chatgpt.com' } });
ok(ob.url === 'https://x.com/a' && ob.ref === 'https://chatgpt.com/' && ob.params.utm_source === 'chatgpt.com' && !('gclid' in ob.params), 'lo que manda el navegador → params, referente y url');

console.log('\nQue llegue siempre');
const fjs = readFileSync(new URL('../public/f.js', import.meta.url), 'utf8');
ok(!/if \(!Object\.keys\(hay\)\.length\) return guardado \|\| null;/.test(fjs) && /hay\._ref = document\.referrer/.test(fjs), 'f.js guarda el referente SIEMPRE en la primera página (antes solo con parámetros de anuncio)');
const lj = readFileSync(new URL('../api/l.js', import.meta.url), 'utf8');
ok(/datos\._origen = origen;/.test(lj) && /origen\._ref = document\.referrer/.test(lj), 'las landings de Acuarius también lo mandan');
const fp = readFileSync(new URL('../api/form-public.js', import.meta.url), 'utf8');
ok(/camposDeOrigen\(o\)/.test(fp) && /\.\.\.deOrigen, \.\.\.pauta/.test(fp), 'form-public lo clasifica y lo guarda en el lead (el primero gana en el merge)');

console.log('\nEl reporte SEO: agregado y sin datos personales (ejecutado)');
process.env.SUPABASE_URL = 'https://sb.test'; process.env.SUPABASE_SERVICE_KEY = 'k';
{
  const { cargarProyecto } = await import('../api/_seo-datos.js');
  const antes = globalThis.fetch;
  let pedidaLeads = '';
  globalThis.fetch = async (url) => {
    const u = String(url);
    const res = (b) => new Response(JSON.stringify(b), { status: 200 });
    if (u.includes('/seo_proyectos?')) return res([{ id: 'p', user_id: 'u1', client_id: 'cli', nombre: 'N', dominio: 'acuarius.app' }]);
    if (u.includes('/leads?')) {
      pedidaLeads = u;
      return res([
        { created_at: '2026-10-18T15:00:00Z', stage: 'ganado', value: 99, custom_fields: { 'Canal de origen': 'Buscadores', Origen: 'Google', 'Página de entrada': '/precios', Sitio: 'acuarius.app', nombre_secreto: 'Ana' } },
        { created_at: '2026-10-18T16:00:00Z', stage: 'nuevo', value: 0, custom_fields: { 'Canal de origen': 'IA', Origen: 'ChatGPT', 'Página de entrada': '/', Sitio: 'www.acuarius.app' } },
        { created_at: '2026-10-18T16:00:00Z', stage: 'nuevo', value: 0, custom_fields: { 'Canal de origen': 'IA', Origen: 'ChatGPT', 'Página de entrada': '/', Sitio: 'otroacuarius.app' } }]);
    }
    return res([]);
  };
  try {
    const d = await cargarProyecto('p', { publico: true });
    const lw = d.trafico.leadsWeb;
    ok(pedidaLeads.includes('user_id=eq.u1') && pedidaLeads.includes('deleted_at=is.null'), 'solo leads de la cuenta, no borrados');
    ok(lw.length === 2 && lw.reduce((a, x) => a + x.leads, 0) === 2, 'cuenta solo los del sitio del proyecto (un dominio parecido no entra)', lw);
    ok(lw.find(x => x.canal === 'Buscadores')?.ganados === 1 && lw.find(x => x.canal === 'Buscadores')?.valor === 99, 'ventas y valor por canal');
    ok(!JSON.stringify(d).includes('Ana') && !JSON.stringify(lw).includes('custom_fields'), 'al enlace no viaja ningún dato personal: solo agregados');
    const P = await import('../public/seo-panel.js');
    const h = P.panelSeo({ ...d, trafico: { ...d.trafico, mesActual: '2026-10', mesAnterior: '2026-09' } }, { seccion: 'trafico' });
    ok(h.includes('Leads y ventas que trajo la web') && h.includes('Leads desde buscadores') && h.includes('$99'), 'el reporte muestra leads y ventas por canal');
    const r = P.panelSeo({ ...d, trafico: { ...d.trafico, mesActual: '2026-10', mesAnterior: '2026-09' } }, { seccion: 'resumen' });
    ok(r.includes('Leads desde buscadores e IAs') && r.includes('data-seccion="trafico"'), 'y en el resumen, con enlace a Tráfico');
  } catch (e) { ok(false, 'cargarProyecto no revienta', e.stack); }
  finally { globalThis.fetch = antes; }
}

console.log(mal ? `\n${mal} fallo(s)` : '\nTodo en verde');
process.exit(mal ? 1 : 0);

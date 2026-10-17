// api/_origen.js — de dónde vino un lead web (canal de origen).
//
// Hasta el 17-10-2026 un lead de formulario solo decía «formulario»: el
// conector (public/f.js) guardaba el origen únicamente si la URL traía
// parámetros de anuncio, así que quien llegaba desde Google orgánico, ChatGPT
// o Instagram entraba sin rastro. Sin eso no hay forma de decirle a un cliente
// «el SEO te trajo 12 leads y 3 ventas». Aquí se clasifica lo que el navegador
// vio al entrar: parámetros de la URL de aterrizaje y la página de la que venía.
// Puro y probado (pruebas/origen-leads.mjs). Solo se importa desde edge.

const host = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };

const BUSCADORES = [['google', 'Google'], ['bing', 'Bing'], ['yahoo', 'Yahoo'], ['duckduckgo', 'DuckDuckGo'], ['ecosia', 'Ecosia'], ['yandex', 'Yandex'], ['baidu', 'Baidu'], ['brave', 'Brave'], ['qwant', 'Qwant'], ['search.aol', 'AOL']];
const IAS = [['chatgpt.com', 'ChatGPT'], ['chat.openai.com', 'ChatGPT'], ['openai.com', 'ChatGPT'], ['perplexity.ai', 'Perplexity'], ['gemini.google.com', 'Gemini'], ['bard.google.com', 'Gemini'],
  ['copilot.microsoft.com', 'Copilot'], ['claude.ai', 'Claude'], ['chat.deepseek.com', 'DeepSeek'], ['deepseek.com', 'DeepSeek'], ['grok.com', 'Grok'], ['meta.ai', 'Meta AI'], ['you.com', 'You.com'], ['chat.mistral.ai', 'Mistral']];
const REDES = [['facebook.com', 'Facebook'], ['fb.com', 'Facebook'], ['l.facebook.com', 'Facebook'], ['lm.facebook.com', 'Facebook'], ['m.facebook.com', 'Facebook'], ['instagram.com', 'Instagram'], ['l.instagram.com', 'Instagram'],
  ['t.co', 'X'], ['x.com', 'X'], ['twitter.com', 'X'], ['linkedin.com', 'LinkedIn'], ['lnkd.in', 'LinkedIn'], ['tiktok.com', 'TikTok'], ['youtube.com', 'YouTube'], ['m.youtube.com', 'YouTube'],
  ['pinterest.com', 'Pinterest'], ['reddit.com', 'Reddit'], ['wa.me', 'WhatsApp'], ['whatsapp.com', 'WhatsApp'], ['threads.net', 'Threads']];

// El nombre de un buscador por su host (google.com.co, www.bing.com…), o null.
function buscador(h) {
  if (!h) return null;
  // Los productos de Google que NO son el buscador.
  if (/^(mail|accounts|docs|drive|calendar|meet|gemini|bard|ads|analytics|search\.google)\./.test(h) || h === 'gemini.google.com') return null;
  for (const [clave, nombre] of BUSCADORES) {
    const partes = h.split('.');
    if (partes.includes(clave) || h.startsWith(clave + '.')) return nombre;
  }
  return null;
}
const de2 = (h, tabla) => { for (const [d, n] of tabla) if (h === d || h.endsWith('.' + d)) return n; return null; };

export const CANALES = ['Buscadores', 'IA', 'Google Ads', 'Meta Ads', 'TikTok Ads', 'Microsoft Ads', 'Otros anuncios', 'Redes sociales', 'Correo', 'Otro sitio', 'Directo'];

/**
 * o: { params: {gclid, utm_source…}, ref: 'https://…', url: 'https://…' (la de aterrizaje) }
 * propio: dominio del sitio (un referente del mismo sitio no es un origen).
 * Devuelve { canal, origen, pagina, referente } — `origen` dicho para personas.
 */
export function clasificarOrigen(o = {}, propio = '') {
  const p = Object.fromEntries(Object.entries(o.params || {}).map(([k, v]) => [String(k).toLowerCase(), String(v || '').trim()]));
  const fuente = (p.utm_source || '').toLowerCase(), medio = (p.utm_medium || '').toLowerCase();
  const pagado = /^(cpc|ppc|paid|paidsocial|paid_social|paid-social|cpm|display|ads?)$/.test(medio) || /paid|cpc/.test(medio);
  const hRef = host(o.ref);
  const hPropio = String(propio || host(o.url) || '').toLowerCase().replace(/^www\./, '');
  const externo = hRef && !(hPropio && (hRef === hPropio || hRef.endsWith('.' + hPropio) || hPropio.endsWith('.' + hRef)));
  const pagina = (() => { try { const u = new URL(o.url); return u.pathname || '/'; } catch { return null; } })();
  const referente = externo ? hRef : null;
  const r = (canal, origen) => ({ canal, origen, pagina, referente });

  // 1. Los clics de anuncio: identifican la plataforma sin ambigüedad.
  if (p.gclid || p.wbraid || p.gbraid) return r('Google Ads', 'Google Ads' + (p.utm_campaign ? ' · ' + p.utm_campaign : ''));
  if (p.msclkid) return r('Microsoft Ads', 'Microsoft Ads');
  if (p.ttclid) return r('TikTok Ads', 'TikTok Ads');
  // fbclid lo pone Facebook en TODO enlace que sale de su app, también en los
  // orgánicos: solo es anuncio si la UTM lo dice.
  if (p.fbclid && (pagado || /^(fb|facebook|ig|instagram|meta)$/.test(fuente) && medio)) {
    if (pagado || medio) return r('Meta Ads', 'Meta Ads' + (p.utm_campaign ? ' · ' + p.utm_campaign : ''));
  }
  // 2. Lo que diga la UTM.
  if (fuente) {
    const ia = de2(fuente, IAS) || de2(fuente.replace(/^https?:\/\//, ''), IAS);
    if (ia) return r('IA', ia);
    if (pagado) {
      if (/google|adwords/.test(fuente)) return r('Google Ads', 'Google Ads' + (p.utm_campaign ? ' · ' + p.utm_campaign : ''));
      if (/^(fb|facebook|ig|instagram|meta)/.test(fuente)) return r('Meta Ads', 'Meta Ads' + (p.utm_campaign ? ' · ' + p.utm_campaign : ''));
      if (/tiktok/.test(fuente)) return r('TikTok Ads', 'TikTok Ads');
      if (/bing|microsoft/.test(fuente)) return r('Microsoft Ads', 'Microsoft Ads');
      return r('Otros anuncios', fuente);
    }
    if (/^(email|e-mail|correo|newsletter|mail)$/.test(medio) || /newsletter|mailchimp|resend/.test(fuente)) return r('Correo', 'Correo' + (p.utm_campaign ? ' · ' + p.utm_campaign : ''));
    if (/^(social|organic_social|social-organic|rrss)$/.test(medio)) return r('Redes sociales', fuente);
    if (/^organic$/.test(medio)) { const b = buscador(fuente + '.com'); if (b) return r('Buscadores', b); }
  }
  // 3. La página de la que venía.
  if (externo) {
    const ia = de2(hRef, IAS);
    if (ia) return r('IA', ia);
    const b = buscador(hRef);
    if (b) return r('Buscadores', b);
    const red = de2(hRef, REDES);
    if (red) return r('Redes sociales', red);
    if (/mail\.|outlook\.|webmail/.test(hRef)) return r('Correo', 'Correo');
    return r('Otro sitio', hRef);
  }
  if (p.fbclid) return r('Redes sociales', 'Facebook / Instagram');
  if (fuente) return r('Otro sitio', fuente);
  return r('Directo', 'Directo o sin información');
}

// Los campos que se guardan en el lead. Los nombres son los que ve el
// asesor en la ficha y los que usan los reportes.
export function camposDeOrigen(o, propio) {
  if (!o || (!o.url && !o.ref && !Object.keys(o.params || {}).length)) return {};
  const c = clasificarOrigen(o, propio);
  const out = { 'Canal de origen': c.canal, 'Origen': c.origen };
  if (c.pagina) out['Página de entrada'] = c.pagina.slice(0, 200);
  // El sitio por el que entró: el reporte SEO de un dominio cuenta solo los
  // leads de ese dominio, aunque el cliente tenga varias webs.
  const sitio = host(o.url);
  if (sitio) out['Sitio'] = sitio;
  if (c.referente) out['Referente'] = c.referente.slice(0, 120);
  return out;
}

// Lo que manda el navegador (f.js o una landing) → { params, ref, url }.
export function origenDelCuerpo(body) {
  const o = (body && typeof body._origen === 'object' && body._origen) ? body._origen : {};
  const params = {};
  for (const [k, v] of Object.entries(o)) if (!k.startsWith('_') && v) params[k] = String(v).slice(0, 200);
  return { params, ref: o._ref || null, url: o._url || null };
}

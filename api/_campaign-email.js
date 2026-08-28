// api/_campaign-email.js
// Plantilla compartida del email de campaña (v2) — la usan el motor de envío
// (api/cron-campaigns.js) y el correo de prueba (api/campaigns.js action=test).
// El guion bajo inicial evita que Vercel la exponga como endpoint.
// v2: preencabezado oculto, barra de acento de marca, links con UTM
// automáticos, botón CTA opcional y footer de baja.

export function utmSlug(name) {
  return String(name || 'campana').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'campana';
}

export function appendUtm(url, campaignName) {
  try {
    const u = new URL(url);
    if (u.searchParams.get('utm_source')) return url; // no pisar UTMs del usuario
    u.searchParams.set('utm_source', 'acuarius');
    u.searchParams.set('utm_medium', 'email');
    u.searchParams.set('utm_campaign', utmSlug(campaignName));
    return u.toString();
  } catch { return url; }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Texto plano → párrafos HTML con URLs clicables (y UTM si aplica)
function paragraphs(text, { accent, utm, campaignName }) {
  const linkRe = /(https?:\/\/[^\s<>"']+)/g;
  return String(text || '').split('\n').map(line => {
    if (!line.trim()) return '';
    const html = escapeHtml(line).replace(linkRe, (m) => {
      const href = utm ? appendUtm(m, campaignName) : m;
      return '<a href="' + href + '" style="color:' + accent + ';text-decoration:underline">' + m + '</a>';
    });
    return '<p style="margin:0 0 14px">' + html + '</p>';
  }).join('');
}

// HTML completo del email de campaña.
// campaign: {name, preheader, cta_text, cta_url, accent_color, utm}
// bodyTxt: cuerpo ya personalizado con renderVars; unsubUrl: link de baja del lead.
// htmlDiseno: cuando la campaña se hizo con el constructor visual, su HTML YA
// personalizado. Manda sobre el cuerpo de texto — si viene, el body no se usa.
export function campaignHtml(campaign, bodyTxt, unsubUrl, htmlDiseno) {
  const accent = /^#[0-9a-fA-F]{6}$/.test(campaign.accent_color || '') ? campaign.accent_color : '#2563EB';
  const utm = campaign.utm !== false;
  const pre = campaign.preheader
    ? '<div style="display:none;max-height:0px;overflow:hidden;mso-hide:all">' + escapeHtml(campaign.preheader) + '&nbsp;&zwnj;'.repeat(30) + '</div>'
    : '';
  const cta = (campaign.cta_text && campaign.cta_url)
    ? '<div style="text-align:center;margin:26px 0"><a href="' + (utm ? appendUtm(campaign.cta_url, campaign.name) : campaign.cta_url) + '" ' +
      'style="display:inline-block;background:' + accent + ';color:#ffffff;font-weight:bold;font-size:15px;' +
      'padding:13px 34px;border-radius:8px;text-decoration:none">' + escapeHtml(campaign.cta_text) + '</a></div>'
    : '';
  const headerImg = /^https?:\/\//i.test(campaign.header_image_url || '')
    ? '<img src="' + campaign.header_image_url + '" alt="" style="display:block;width:100%;max-width:560px;border-radius:10px;margin:0 0 22px">'
    : '<div style="border-top:4px solid ' + accent + ';margin-bottom:22px"></div>';
  // La baja NO es opcional: va por ley y además la exige la cabecera
  // List-Unsubscribe que ya mandamos. Por eso se pega fuera del diseño, donde
  // nadie pueda borrarla arrastrando bloques.
  const bajaHtml =
    '<p style="font-family:Arial,Helvetica,sans-serif;margin:26px auto 0;padding-top:14px;border-top:1px solid #eee;' +
    'font-size:11.5px;color:#9ca3af;max-width:560px;text-align:center">' +
    '¿No quieres recibir estos correos? <a href="' + unsubUrl + '" style="color:#9ca3af">Darte de baja</a></p>';

  // El diseño manda y descarta cuerpo, imagen de cabecera y botón: dentro de él
  // esas cosas ya existen como bloques. El asistente esconde esos campos cuando
  // hay diseño precisamente por esto — antes seguían visibles y quien subía una
  // imagen la perdía sin que nada se lo dijera.
  if (htmlDiseno) return pre + htmlDiseno + bajaHtml;

  return pre +
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#1a1a2e;max-width:560px;margin:0 auto">' +
    headerImg +
    paragraphs(bodyTxt, { accent, utm, campaignName: campaign.name }) +
    cta +
    '<p style="margin:26px 0 0;padding-top:14px;border-top:1px solid #eee;font-size:11.5px;color:#9ca3af">' +
    '¿No quieres recibir estos correos? <a href="' + unsubUrl + '" style="color:#9ca3af">Darte de baja</a></p></div>';
}

// api/_email-layout.js
// La plantilla de todos los correos que manda Acuarius.
//
// Antes cada aviso llevaba su propio HTML suelto: llegaban planos, sin logo y
// sin la línea gráfica del producto. Un correo es a veces lo único que un
// comercial ve de Acuarius en todo el día, así que tiene que parecerse a la app.
//
// Se escribe con TABLAS y estilos en línea a propósito. No es descuido ni
// código antiguo: Outlook y Gmail descartan <style>, flexbox y grid, y una
// maqueta moderna se desmonta ahí. Lo que aquí parece torpe es lo único que se
// ve igual en todas partes.

const AZUL = '#1E2BCC';
const AZUL_OSCURO = '#1520B0';
const FONDO = '#F4F5FB';
const TEXTO = '#14161F';
const SUAVE = '#5B6072';
const BORDE = '#E4E6F2';
const LOGO = 'https://app.acuarius.app/logo-white.png';

export function esc(t) {
  return String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Caja de datos: lo que hay que leer de un vistazo (el lead, la nota, la cifra).
export function bloque(contenido, color = AZUL) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0">
  <tr><td style="border:1px solid ${BORDE};border-left:3px solid ${color};border-radius:10px;padding:14px 16px;background:#FBFBFE;color:${TEXTO};font-size:14px;line-height:1.6">${contenido}</td></tr>
</table>`;
}

// Lista de "qué revisar" / "qué pasó". Los <ul> se maquetan distinto en cada
// cliente de correo, así que va como tabla de filas.
export function pasos(items) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0">
${items.map((t, i) => `  <tr>
    <td width="26" valign="top" style="padding:4px 0;color:${AZUL};font-size:14px;font-weight:700">${i + 1}.</td>
    <td style="padding:4px 0;color:${TEXTO};font-size:14px;line-height:1.6">${t}</td>
  </tr>`).join('\n')}
</table>`;
}

/**
 * titulo   — el titular, ya escapado por quien llama si viene de datos
 * intro    — una frase de contexto (opcional)
 * cuerpo   — HTML libre: bloque(), pasos(), párrafos…
 * cta      — { texto, url } (opcional)
 * pie      — nota pequeña al final (opcional)
 * preheader— lo que se lee en la bandeja junto al asunto (opcional)
 */
export function emailHtml({ titulo, intro, cuerpo, cta, pie, preheader }) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:${FONDO};-webkit-font-smoothing:antialiased">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${preheader}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${FONDO};padding:28px 12px">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid ${BORDE};border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">

      <tr><td style="background:${AZUL};padding:18px 26px">
        <img src="${LOGO}" alt="Acuarius" width="112" style="display:block;border:0;height:auto;max-width:112px">
      </td></tr>

      <tr><td style="padding:26px 26px 8px">
        <h1 style="margin:0 0 6px;font-size:20px;line-height:1.3;font-weight:800;color:${TEXTO};letter-spacing:-.02em">${titulo}</h1>
        ${intro ? `<p style="margin:0;font-size:14px;line-height:1.6;color:${SUAVE}">${intro}</p>` : ''}
      </td></tr>

      <tr><td style="padding:0 26px 4px;color:${TEXTO};font-size:14px;line-height:1.6">${cuerpo || ''}</td></tr>

      ${cta ? `<tr><td style="padding:8px 26px 24px">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="border-radius:10px;background:${AZUL}">
            <a href="${cta.url}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:10px;background:${AZUL};border:1px solid ${AZUL_OSCURO}">${cta.texto}</a>
          </td>
        </tr></table>
      </td></tr>` : '<tr><td style="height:14px"></td></tr>'}

      ${pie ? `<tr><td style="padding:0 26px 22px;font-size:12.5px;line-height:1.6;color:${SUAVE}">${pie}</td></tr>` : ''}

      <tr><td style="border-top:1px solid ${BORDE};padding:16px 26px;background:#FBFBFE">
        <p style="margin:0;font-size:12px;line-height:1.6;color:${SUAVE}">
          Te llega desde <a href="https://app.acuarius.app" style="color:${AZUL};text-decoration:none;font-weight:700">Acuarius</a>, tu CRM con agentes de IA.
        </p>
      </td></tr>

    </table>
    <p style="margin:14px 0 0;font-size:11.5px;color:${SUAVE};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">Acuarius · marketing con inteligencia artificial</p>
  </td></tr>
</table>
</body></html>`;
}

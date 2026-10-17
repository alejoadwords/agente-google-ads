/* Acuarius — de dónde llegó cada visita a acuarius.app y app.acuarius.app.
 *
 * Lo cargan la landing (acuarius.app, otro repo) y la app. En la PRIMERA
 * visita guarda en una cookie compartida por *.acuarius.app la página de la
 * que venía, la página por la que entró y los parámetros de campaña. Gana el
 * primero y dura 30 días: quien lee hoy desde ChatGPT y se registra el viernes
 * desde el marcador sigue contando como ChatGPT. Al registrarse, la app manda
 * esto a /api/origen-cuenta, que lo clasifica (api/_origen.js).
 *
 * Una navegación entre acuarius.app y la app no es un origen: se ignora.
 */
(function () {
  try {
    var NOMBRE = 'acu_origen';
    var hay = document.cookie.split('; ').some(function (c) { return c.indexOf(NOMBRE + '=') === 0; });
    if (hay) return;
    var ref = document.referrer || '';
    try { if (ref && /(^|\.)acuarius\.app$/.test(new URL(ref).hostname)) ref = ''; } catch (e) { ref = ''; }
    var o = { u: location.href.slice(0, 400), r: ref.slice(0, 300), t: Date.now() };
    var q = {}, p = new URLSearchParams(location.search);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'wbraid', 'gbraid', 'fbclid', 'ttclid', 'msclkid'].forEach(function (k) {
      var v = p.get(k);
      if (v) q[k] = v.slice(0, 150);
    });
    if (Object.keys(q).length) o.p = q;
    var dominio = /(^|\.)acuarius\.app$/.test(location.hostname) ? '; domain=.acuarius.app' : '';
    document.cookie = NOMBRE + '=' + encodeURIComponent(JSON.stringify(o)) + '; path=/; max-age=2592000; SameSite=Lax' + dominio +
      (location.protocol === 'https:' ? '; Secure' : '');
  } catch (e) { /* sin cookies (modo privado): la visita sigue igual, solo sin origen */ }
})();

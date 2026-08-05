/* Acuarius — conector de formularios existentes.
 * Instalación: <script src="https://app.acuarius.app/f.js" data-token="TU_TOKEN" defer></script>
 * Opcional: data-form="#miFormulario" para conectar solo un formulario específico
 * (por defecto conecta todos los <form> de la página).
 * Al enviarse el formulario, copia los campos (por name/id/type/placeholder)
 * y los manda a Acuarius sin interferir con el envío original.
 */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var token = script.getAttribute('data-token');
  if (!token || !/^[a-f0-9]{24,64}$/i.test(token)) return;
  var selector = script.getAttribute('data-form');
  var ENDPOINT = 'https://app.acuarius.app/api/form-public?token=' + token;

  function classify(el) {
    var hints = ((el.name || '') + ' ' + (el.id || '') + ' ' + (el.placeholder || '') + ' ' + (el.getAttribute('autocomplete') || '')).toLowerCase();
    if (el.type === 'email' || /mail|correo/.test(hints)) return 'email';
    if (el.type === 'tel' || /phone|tel[eé]?f|whats|celular|m[oó]vil/.test(hints)) return 'phone';
    if (/company|empresa|negocio|business/.test(hints)) return 'company';
    if (/name|nombre/.test(hints) && !/user|usuario|file/.test(hints)) return 'name';
    return null;
  }

  function harvest(form) {
    var data = {};
    var extras = [];
    var els = form.querySelectorAll('input, textarea, select');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el.value || el.type === 'password' || el.type === 'hidden' || el.type === 'submit' || el.type === 'file' || el.type === 'checkbox' && !el.checked) continue;
      var kind = classify(el);
      if (kind && !data[kind]) data[kind] = el.value.trim();
      else if (el.value.trim().length > 1 && extras.length < 8) {
        extras.push((el.name || el.id || 'campo') + ': ' + el.value.trim().slice(0, 150));
      }
    }
    if (extras.length) data.mensaje = extras.join(' · ');
    data._page = location.href;
    return data;
  }

  function hook(form) {
    if (form.__acuarius) return;
    form.__acuarius = true;
    form.addEventListener('submit', function () {
      try {
        var data = harvest(form);
        if (!data.email && !data.phone && !data.name) return;
        var cuerpo = JSON.stringify(data);
        // text/plain a propósito: es de los pocos tipos que no obligan a un
        // preflight de CORS. Con application/json el navegador exigía preflight,
        // sendBeacon no sabe hacerlo, descartaba el envío... y aun así devolvía
        // true, así que el fallback nunca corría y el lead se perdía entero.
        var blob = new Blob([cuerpo], { type: 'text/plain;charset=UTF-8' });
        if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, blob)) return;
        fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: cuerpo, keepalive: true });
      } catch (e) {}
    });
  }

  function init() {
    var forms = selector ? document.querySelectorAll(selector) : document.querySelectorAll('form');
    for (var i = 0; i < forms.length; i++) hook(forms[i]);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  // Formularios inyectados después (SPAs, popups)
  try {
    new MutationObserver(function () { init(); }).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
})();

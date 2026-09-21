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

  /* ── De dónde vino esta persona ───────────────────────────────────────────
   * El problema que resuelve: alguien entra por un anuncio a la portada
   * —con su gclid y sus utm— y rellena el formulario tres páginas después. En
   * ese momento la URL ya no tiene nada, así que el lead llegaba sin origen y
   * la campaña que lo trajo quedaba sin crédito.
   *
   * Se guarda en sessionStorage y GANA EL PRIMERO: si vuelve a entrar por otro
   * anuncio en la misma sesión, el crédito es del que lo trajo. Sobrescribir
   * dejaría que el último anuncio se llevara leads que no generó.
   *
   * sessionStorage y no localStorage a propósito: una visita de hace tres
   * semanas no explica el formulario de hoy. */
  var LLAVE = '_acuarius_origen';
  var PARAMS = ['gclid', 'wbraid', 'gbraid', 'fbclid', 'ttclid', 'msclkid',
                'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
                'campaignid', 'adgroupid', 'creative', 'keyword', 'matchtype'];

  function origen() {
    var guardado = null;
    try { guardado = JSON.parse(sessionStorage.getItem(LLAVE) || 'null'); } catch (e) {}
    if (guardado && guardado._url) return guardado;

    var hay = {};
    try {
      var p = new URLSearchParams(location.search);
      for (var i = 0; i < PARAMS.length; i++) {
        var v = (p.get(PARAMS[i]) || '').trim();
        if (v) hay[PARAMS[i]] = v.slice(0, 200);
      }
    } catch (e) {}
    if (!Object.keys(hay).length) return guardado || null;

    hay._url = location.href.slice(0, 500);
    if (document.referrer) hay._ref = document.referrer.slice(0, 300);
    // Si falla el guardado (modo privado, cookies bloqueadas) se sigue igual:
    // en la página de aterrizaje el dato viaja, que es el caso más común.
    try { sessionStorage.setItem(LLAVE, JSON.stringify(hay)); } catch (e) {}
    return hay;
  }

  // Se llama al cargar, no al enviar: para cuando alguien rellena el
  // formulario, la URL de aterrizaje puede llevar rato perdida.
  try { origen(); } catch (e) {}

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
    var o = origen();
    if (o) data._origen = o;
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

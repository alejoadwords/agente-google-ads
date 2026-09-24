// public/movil-enganche.js — cuándo se muestra la versión móvil
//
// El responsive de hoy es feo pero FUNCIONA: desde él se crea un lead, se
// edita, se lanza una campaña. La versión móvil se ve mucho mejor y todavía
// no hace todo eso. Encenderla para todos sería cambiar sensación por
// capacidad, y a un asesor que necesita registrar una llamada ahora mismo eso
// no le sirve.
//
// Por eso: **se ofrece, no se impone**. Quien la enciende puede volver en un
// toque, y la elección se recuerda. Cuando alcance paridad, cambiar el valor
// por defecto es una línea.

(function () {
  'use strict';

  var ANCHO = 768;                    // el mismo corte que usa el resto del CSS
  var LLAVE = 'acuarius_movil';       // 'si' | 'no' | ausente = no ha elegido
  var cargado = false;

  function esTelefono() {
    try { return window.matchMedia('(max-width: ' + ANCHO + 'px)').matches; }
    catch (e) { return false; }
  }
  function eleccion() {
    try { return localStorage.getItem(LLAVE); } catch (e) { return null; }
  }
  function recordar(v) {
    try { localStorage.setItem(LLAVE, v); } catch (e) {}
  }

  // Carga los dos ficheros del móvil. Solo la primera vez, y solo si de verdad
  // se va a usar: son 88 kB que un escritorio no tiene por qué bajar nunca.
  function cargar() {
    if (cargado) return Promise.resolve();
    cargado = true;
    return new Promise(function (listo, falla) {
      var css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = '/movil-app.css';
      document.head.appendChild(css);
      var js = document.createElement('script');
      js.src = '/movil-app.js';
      js.onload = listo;
      // Si no carga, NO se deja la pantalla a medias: se vuelve al responsive,
      // que funciona. Quedarse en blanco por un fichero que no llegó es dejar
      // a alguien sin CRM en la calle.
      js.onerror = function () {
        cargado = false;
        apagar();
        if (typeof showToast === 'function') {
          showToast('No se pudo cargar la versión móvil. Seguimos con la de siempre.', 'error');
        }
        falla(new Error('movil-app.js no cargó'));
      };
      document.body.appendChild(js);
    });
  }

  function encender() {
    recordar('si');
    document.body.classList.add('modo-movil');
    var host = document.getElementById('movil-host');
    if (host) host.hidden = false;
    cargar().then(function () {
      // Se le pasa el fetchAuth de la aplicación: la sesión ya está resuelta
      // aquí, y abrir una segunda con Clerk obligaría a entrar dos veces.
      if (typeof movilMontar === 'function') {
        movilMontar({ fetchAuth: typeof fetchAuth === 'function' ? fetchAuth : null });
      }
    }).catch(function () {});
  }

  function apagar() {
    recordar('no');
    document.body.classList.remove('modo-movil');
    var host = document.getElementById('movil-host');
    if (host) host.hidden = true;
  }

  // La franja que lo ofrece. Solo en teléfono, solo si no ha elegido todavía, y
  // se puede decir que no: una oferta que no se puede rechazar es un aviso.
  function ofrecer() {
    if (document.getElementById('movil-oferta')) return;
    var b = document.createElement('div');
    b.id = 'movil-oferta';
    b.setAttribute('role', 'status');
    b.innerHTML =
      '<span>Hay una versión de Acuarius hecha para el teléfono.</span>' +
      '<button type="button" id="movil-si">Probarla</button>' +
      '<button type="button" id="movil-no">Ahora no</button>';
    document.body.appendChild(b);
    // Los oyentes se buscan DENTRO de la franja y con guarda. Con
    // `document.getElementById(...).addEventListener(...)` bastaba que el
    // elemento no estuviera para lanzar aquí, y esto corre en el arranque: la
    // excepción no la recoge nadie y se lleva por delante lo que venga
    // después. Es el mismo patrón que dejó la pantalla en blanco.
    var si = b.querySelector('#movil-si');
    var no = b.querySelector('#movil-no');
    if (si) si.addEventListener('click', function () { b.remove(); encender(); });
    if (no) no.addEventListener('click', function () { b.remove(); apagar(); });
  }

  function decidir() {
    if (!esTelefono()) return;          // en escritorio no se ofrece ni se carga
    var q = eleccion();
    if (q === 'si') { encender(); return; }
    if (q === 'no') return;             // dijo que no: no se insiste cada vez
    ofrecer();
  }

  // Se expone para poder volver desde dentro del móvil y para la prueba.
  window.movilEnganche = { encender: encender, apagar: apagar, esTelefono: esTelefono };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', decidir, { once: true });
  } else {
    decidir();
  }
})();

/* Acuarius — widget de chat web.
 * Instalación: <script src="https://app.acuarius.app/w.js" data-key="CLAVE" defer></script>
 *
 * Vive en la web de otra persona, con su CSS y sus scripts. De ahí dos reglas
 * que no se negocian:
 *   1. Todo dentro de un shadow root. Sin él, el primer cliente con un
 *      `* { box-sizing: content-box }` nos deforma la burbuja y no hay forma de
 *      depurarlo a distancia.
 *   2. Nada de excepciones hacia fuera. Un error nuestro en la consola parece un
 *      fallo DE SU WEB.
 *
 * No usa sendBeacon a propósito: con content-type JSON dispara un preflight que
 * sendBeacon no puede hacer, devuelve true igualmente y el mensaje se pierde en
 * silencio. Es lo que nos costó el 100% de los leads del conector de
 * formularios; aquí se usa fetch y se comprueba la respuesta.
 */
(function () {
  'use strict';
  try {
    var script = document.currentScript;
    if (!script) return;
    var KEY = script.getAttribute('data-key') || '';
    if (!/^[a-f0-9]{32}$/i.test(KEY)) return;
    var API = (script.src.split('/w.js')[0]) + '/api/webchat';

    // ── Estado del visitante ────────────────────────────────────────────────
    var LS = 'acuarius_wc_' + KEY.slice(0, 8);
    var st = {};
    try { st = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { st = {}; }
    if (!/^[a-f0-9]{32}$/i.test(st.v || '')) {
      st.v = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      st.msgs = [];
    }
    // La conversación no es eterna: el que vuelve a los tres meses no debería
    // reabrir el hilo de marzo.
    if (st.ultimo && Date.now() - st.ultimo > 24 * 3600 * 1000) { st.msgs = []; st.since = null; }
    st.msgs = Array.isArray(st.msgs) ? st.msgs.slice(-50) : [];
    function guardar() { try { localStorage.setItem(LS, JSON.stringify(st)); } catch (e) {} }

    var cfg = null, abierto = false, timer = null, enviando = false;

    // ── Interfaz ────────────────────────────────────────────────────────────
    var host = document.createElement('div');
    host.style.cssText = 'position:fixed;z-index:2147483000;bottom:0;right:0';
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

    function pintarBase() {
      var izq = cfg.posicion === 'izquierda';
      host.style[izq ? 'left' : 'right'] = '0';
      host.style[izq ? 'right' : 'left'] = 'auto';
      root.innerHTML =
        '<style>' +
        ':host,*{box-sizing:border-box}' +
        '.wrap{position:fixed;bottom:20px;' + (izq ? 'left' : 'right') + ':20px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}' +
        '.burbuja{width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;background:' + cfg.color + ';color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 24px rgba(0,0,0,.22);transition:transform .18s}' +
        '.burbuja:hover{transform:scale(1.06)}' +
        '.panel{position:absolute;bottom:70px;' + (izq ? 'left' : 'right') + ':0;width:340px;max-width:calc(100vw - 32px);height:460px;max-height:calc(100vh - 120px);background:#fff;border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,.22);display:none;flex-direction:column;overflow:hidden}' +
        '.panel.abierto{display:flex}' +
        '.hdr{background:' + cfg.color + ';color:#fff;padding:14px 16px;display:flex;align-items:center;justify-content:space-between}' +
        '.hdr b{font-size:14px;font-weight:600}' +
        '.cerrar{background:transparent;border:none;color:#fff;cursor:pointer;font-size:20px;line-height:1;padding:0 2px;opacity:.85}' +
        '.msgs{flex:1;overflow-y:auto;padding:14px;background:#F7F8FC;display:flex;flex-direction:column;gap:8px}' +
        '.m{max-width:82%;padding:9px 12px;border-radius:14px;font-size:13.5px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}' +
        '.m.ag{background:#fff;color:#1B1F3B;align-self:flex-start;border-bottom-left-radius:5px;box-shadow:0 1px 3px rgba(0,0,0,.07)}' +
        '.m.yo{background:' + cfg.color + ';color:#fff;align-self:flex-end;border-bottom-right-radius:5px}' +
        '.esperando{align-self:flex-start;display:flex;gap:4px;padding:11px 13px;background:#fff;border-radius:14px;box-shadow:0 1px 3px rgba(0,0,0,.07)}' +
        '.esperando i{width:6px;height:6px;border-radius:50%;background:#B6BAD0;animation:p 1.3s infinite}' +
        '.esperando i:nth-child(2){animation-delay:.18s}.esperando i:nth-child(3){animation-delay:.36s}' +
        '@keyframes p{0%,60%,100%{opacity:.35}30%{opacity:1}}' +
        '.pie{display:flex;gap:8px;padding:10px;border-top:1px solid #E8EAF2;background:#fff}' +
        '.pie input{flex:1;border:1px solid #E8EAF2;border-radius:20px;padding:9px 13px;font-size:13.5px;outline:none;font-family:inherit;color:#1B1F3B;background:#fff}' +
        '.pie input:focus{border-color:' + cfg.color + '}' +
        '.pie button{background:' + cfg.color + ';color:#fff;border:none;border-radius:50%;width:36px;height:36px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center}' +
        '.pie button:disabled{opacity:.45;cursor:default}' +
        '.err{font-size:11.5px;color:#C0392B;padding:0 14px 8px;background:#fff}' +
        '.hp{position:absolute;left:-9999px;width:1px;height:1px}' +
        '</style>' +
        '<div class="wrap">' +
        '<div class="panel" part="panel">' +
          '<div class="hdr"><b></b><button class="cerrar" aria-label="Cerrar">&times;</button></div>' +
          '<div class="msgs"></div>' +
          '<div class="err" style="display:none"></div>' +
          '<form class="pie">' +
            '<input type="text" placeholder="Escribe tu mensaje..." autocomplete="off" maxlength="2000">' +
            '<input class="hp" tabindex="-1" aria-hidden="true">' +
            '<button type="submit" aria-label="Enviar"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>' +
          '</form>' +
        '</div>' +
        '<button class="burbuja" aria-label="Abrir chat">' +
          '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/></svg>' +
        '</button></div>';

      q('.hdr b').textContent = cfg.titulo;
      q('.burbuja').addEventListener('click', alternar);
      q('.cerrar').addEventListener('click', alternar);
      q('.pie').addEventListener('submit', function (e) { e.preventDefault(); enviar(); });
    }

    function q(sel) { return root.querySelector(sel); }

    function pintarMensajes() {
      var cont = q('.msgs');
      if (!cont) return;
      cont.innerHTML = '';
      if (!st.msgs.length && cfg.saludo) st.msgs.push({ de: 'ag', texto: cfg.saludo });
      st.msgs.forEach(function (m) {
        var d = document.createElement('div');
        d.className = 'm ' + (m.de === 'yo' ? 'yo' : 'ag');
        d.textContent = m.texto;          // textContent, nunca innerHTML
        cont.appendChild(d);
      });
      if (enviando) {
        var e = document.createElement('div');
        e.className = 'esperando';
        e.innerHTML = '<i></i><i></i><i></i>';
        cont.appendChild(e);
      }
      cont.scrollTop = cont.scrollHeight;
    }

    function error(txt) {
      var el = q('.err');
      if (!el) return;
      el.textContent = txt || '';
      el.style.display = txt ? 'block' : 'none';
    }

    function alternar() {
      abierto = !abierto;
      q('.panel').classList.toggle('abierto', abierto);
      if (abierto) { pintarMensajes(); q('.pie input').focus(); }
      ritmo();
    }

    // ── Red ─────────────────────────────────────────────────────────────────
    function enviar() {
      var input = q('.pie input');
      var texto = (input.value || '').trim();
      if (!texto || enviando) return;
      if (q('.hp').value) return;                       // bot que rellena todo
      input.value = '';
      error('');
      st.msgs.push({ de: 'yo', texto: texto });
      st.ultimo = Date.now();
      enviando = true; pintarMensajes(); guardar();

      fetch(API + '?key=' + KEY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ v: st.v, text: texto }),
      })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (d) {
          enviando = false;
          if (d && d.error) error(d.error);
          recibir(d && d.mensajes);
        })
        .catch(function () {
          enviando = false;
          error('No pudimos enviar tu mensaje. Revisa tu conexión.');
          pintarMensajes();
        });
    }

    function recibir(lista) {
      (lista || []).forEach(function (m) {
        if (!m.texto) return;
        st.msgs.push({ de: 'ag', texto: m.texto });
        if (!st.since || m.fecha > st.since) st.since = m.fecha;
      });
      st.ultimo = Date.now();
      guardar();
      pintarMensajes();
    }

    function sondear() {
      fetch(API + '?key=' + KEY + '&v=' + st.v + '&since=' + encodeURIComponent(st.since || new Date(Date.now() - 60000).toISOString()))
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (d) { if (d && d.mensajes && d.mensajes.length) recibir(d.mensajes); })
        .catch(function () {});
    }

    // Abierto sondea cada 4 s; cerrado cada 20; y para del todo tras 10 minutos
    // sin actividad. Una pestaña olvidada no debe sondear toda la noche.
    function ritmo() {
      if (timer) clearInterval(timer);
      timer = setInterval(function () {
        if (Date.now() - (st.ultimo || 0) > 10 * 60 * 1000) { clearInterval(timer); timer = null; return; }
        sondear();
      }, abierto ? 4000 : 20000);
    }

    ['click', 'keydown'].forEach(function (ev) {
      document.addEventListener(ev, function () {
        if (!timer && Date.now() - (st.ultimo || 0) > 10 * 60 * 1000) { st.ultimo = Date.now(); ritmo(); }
      }, { passive: true });
    });

    // ── Arranque ────────────────────────────────────────────────────────────
    fetch(API + '?key=' + KEY)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.activo) return;                    // canal apagado o dominio no permitido
        cfg = d;
        document.body.appendChild(host);
        pintarBase();
        pintarMensajes();
        ritmo();
      })
      .catch(function () {});
  } catch (e) { /* nunca hacia fuera: es la web de otro */ }
})();

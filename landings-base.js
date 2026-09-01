// public/landings-base.js
// Diseños de arranque de las páginas de aterrizaje. Van en un fichero aparte
// —como plantillas-base.js— porque son texto pesado que no le sirve a quien
// nunca crea una página.
//
// Reglas que sigue cada plantilla, y que hay que respetar al añadir otra:
//   · Todo el estilo va en el CSS de la plantilla, con clases propias con
//     prefijo. Nada de estilos en línea: el usuario tiene que poder cambiar
//     colores desde el constructor sin pelear con !important.
//   · Móvil primero de verdad: se prueban a 390px antes de darlas por buenas.
//   · Un solo formulario, con los `name` que entiende /api/form-public
//     (nombre, email, telefono, mensaje).
//   · Textos de ejemplo creíbles y en español de LatAm, no «Lorem ipsum»:
//     una plantilla con relleno latino se publica tal cual más veces de las
//     que uno cree.

window.LANDINGS_BASE = [
  {
    id: 'captura',
    nombre: 'Captación con formulario',
    descripcion: 'Una promesa clara, tres motivos y el formulario a la vista. La que más convierte para pauta.',
    html: `
<section class="lp-hero">
  <div class="lp-wrap lp-hero-grid">
    <div class="lp-hero-txt">
      <span class="lp-pill">Cupos limitados</span>
      <h1>Encuentra el apartamento que sí se ajusta a lo que buscas</h1>
      <p class="lp-lead">Te mostramos solo las opciones que cumplen tu presupuesto y tu zona. Sin vueltas y sin visitas perdidas.</p>
      <ul class="lp-checks">
        <li>Selección hecha por un asesor, no por un buscador</li>
        <li>Te acompañamos hasta la firma del contrato</li>
        <li>Respuesta el mismo día</li>
      </ul>
    </div>
    <div class="lp-card">
      <h2>Cuéntanos qué buscas</h2>
      <p class="lp-card-sub">Te escribimos hoy mismo.</p>
      <form data-gracias="¡Listo! Un asesor te escribe en las próximas horas.">
        <label>Nombre<input type="text" name="nombre" placeholder="Tu nombre" required></label>
        <label>WhatsApp<input type="tel" name="telefono" placeholder="300 000 0000" required></label>
        <label>Correo<input type="email" name="email" placeholder="tu@correo.com"></label>
        <label>¿Qué buscas?<textarea name="mensaje" rows="3" placeholder="Zona, presupuesto, número de habitaciones…"></textarea></label>
        <button type="submit" class="lp-btn">Quiero que me contacten</button>
        <p class="lp-nota">Tus datos solo se usan para contactarte.</p>
      </form>
    </div>
  </div>
</section>

<section class="lp-pruebas">
  <div class="lp-wrap">
    <h2 class="lp-h2">Por qué la gente nos elige</h2>
    <div class="lp-cols">
      <div class="lp-col">
        <div class="lp-num">01</div>
        <h3>Sin perder tiempo</h3>
        <p>Filtramos antes de mostrarte nada. Ves tres opciones buenas, no treinta regulares.</p>
      </div>
      <div class="lp-col">
        <div class="lp-num">02</div>
        <h3>Un solo interlocutor</h3>
        <p>El mismo asesor de principio a fin. No repites tu historia cinco veces.</p>
      </div>
      <div class="lp-col">
        <div class="lp-num">03</div>
        <h3>Papeleo resuelto</h3>
        <p>Contrato, seguro y entrega. Te decimos qué falta y cuándo.</p>
      </div>
    </div>
  </div>
</section>

<section class="lp-cierre">
  <div class="lp-wrap">
    <h2>¿Empezamos hoy?</h2>
    <p>Déjanos tus datos arriba y te escribimos en el mismo día.</p>
  </div>
</section>`,
    css: `
.lp-wrap{max-width:1080px;margin:0 auto;padding:0 22px}
.lp-hero{background:linear-gradient(160deg,#101433 0%,#1E2BCC 100%);color:#fff;padding:64px 0 72px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif}
.lp-hero-grid{display:grid;grid-template-columns:1.05fr .95fr;gap:52px;align-items:center}
.lp-pill{display:inline-block;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.25);color:#fff;font-size:12.5px;font-weight:600;padding:6px 13px;border-radius:999px;margin-bottom:18px}
.lp-hero h1{font-size:44px;line-height:1.1;letter-spacing:-1px;margin:0 0 16px;font-weight:800}
.lp-lead{font-size:17px;line-height:1.6;opacity:.9;margin:0 0 24px;max-width:30em}
.lp-checks{list-style:none;padding:0;margin:0;display:grid;gap:11px}
.lp-checks li{position:relative;padding-left:30px;font-size:15.5px;opacity:.95}
.lp-checks li::before{content:'';position:absolute;left:0;top:6px;width:18px;height:18px;border-radius:50%;background:rgba(255,255,255,.18);
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3.4' stroke-linecap='round'%3E%3Cpath d='M20 6L9 17l-5-5'/%3E%3C/svg%3E");
  background-size:11px;background-repeat:no-repeat;background-position:center}
.lp-card{background:#fff;color:#101433;border-radius:18px;padding:30px 28px;box-shadow:0 24px 60px rgba(4,6,30,.32)}
.lp-card h2{font-size:22px;margin:0 0 4px;letter-spacing:-.4px}
.lp-card-sub{font-size:14px;color:#6b7280;margin:0 0 20px}
.lp-card label{display:block;font-size:12.5px;font-weight:700;color:#374151;margin-bottom:13px}
.lp-card input,.lp-card textarea{width:100%;margin-top:5px;padding:11px 13px;border:1.5px solid #E4E6F0;border-radius:10px;font-size:15px;font-family:inherit;outline:none;background:#fff;color:#101433}
.lp-card input:focus,.lp-card textarea:focus{border-color:#1E2BCC}
.lp-btn{width:100%;background:#1E2BCC;color:#fff;border:0;padding:14px;border-radius:11px;font-size:16px;font-weight:700;font-family:inherit;cursor:pointer;margin-top:6px}
.lp-btn:hover{background:#1520B0}
.lp-nota{font-size:11.5px;color:#9ca3af;text-align:center;margin:10px 0 0}
.lp-pruebas{padding:64px 0;background:#F7F8FC;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#101433}
.lp-h2{font-size:29px;text-align:center;margin:0 0 40px;letter-spacing:-.6px}
.lp-cols{display:grid;grid-template-columns:repeat(3,1fr);gap:26px}
.lp-col{background:#fff;border:1px solid #E9EAF3;border-radius:15px;padding:26px 24px}
.lp-num{font-size:12px;font-weight:800;color:#1E2BCC;letter-spacing:1.5px;margin-bottom:10px}
.lp-col h3{font-size:18px;margin:0 0 8px;letter-spacing:-.3px}
.lp-col p{font-size:14.5px;line-height:1.65;color:#5A607A;margin:0}
.lp-cierre{background:#101433;color:#fff;padding:54px 0;text-align:center;font-family:system-ui,-apple-system,'Segoe UI',sans-serif}
.lp-cierre h2{font-size:27px;margin:0 0 8px;letter-spacing:-.5px}
.lp-cierre p{font-size:16px;opacity:.75;margin:0}
@media(max-width:860px){
  .lp-hero{padding:44px 0 52px}
  .lp-hero-grid{grid-template-columns:1fr;gap:34px}
  .lp-hero h1{font-size:33px}
  .lp-cols{grid-template-columns:1fr}
  .lp-h2{font-size:24px;margin-bottom:28px}
}`,
  },
  {
    id: 'cita',
    nombre: 'Agendar una cita',
    descripcion: 'Para servicios que se venden hablando: consultorio, asesoría, visita comercial.',
    html: `
<section class="lp2-hero">
  <div class="lp2-wrap">
    <h1>Agenda tu valoración sin costo</h1>
    <p class="lp2-lead">20 minutos con un especialista para revisar tu caso y decirte, con honestidad, si podemos ayudarte.</p>
    <a href="#agendar" class="lp2-cta">Elegir mi horario</a>
    <p class="lp2-micro">Sin compromiso · Atención el mismo día</p>
  </div>
</section>

<section class="lp2-pasos">
  <div class="lp2-wrap">
    <div class="lp2-paso"><span>1</span><div><h3>Déjanos tus datos</h3><p>Menos de un minuto.</p></div></div>
    <div class="lp2-paso"><span>2</span><div><h3>Te llamamos</h3><p>Coordinamos el horario que te sirva.</p></div></div>
    <div class="lp2-paso"><span>3</span><div><h3>Nos vemos</h3><p>Presencial o por videollamada, como prefieras.</p></div></div>
  </div>
</section>

<section class="lp2-form" id="agendar">
  <div class="lp2-wrap lp2-form-box">
    <h2>Reserva tu cita</h2>
    <form data-gracias="¡Recibido! Te llamamos para confirmar el horario.">
      <div class="lp2-row">
        <label>Nombre<input type="text" name="nombre" placeholder="Tu nombre" required></label>
        <label>Teléfono<input type="tel" name="telefono" placeholder="300 000 0000" required></label>
      </div>
      <label>Correo<input type="email" name="email" placeholder="tu@correo.com"></label>
      <label>¿Cuándo te queda mejor?<textarea name="mensaje" rows="2" placeholder="Ej. entre semana en la mañana"></textarea></label>
      <button type="submit" class="lp2-btn">Agendar mi cita</button>
    </form>
  </div>
</section>`,
    css: `
.lp2-wrap{max-width:900px;margin:0 auto;padding:0 22px}
.lp2-hero{background:#0F766E;color:#fff;text-align:center;padding:76px 0 66px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif}
.lp2-hero h1{font-size:42px;line-height:1.12;letter-spacing:-1px;margin:0 0 16px;font-weight:800}
.lp2-lead{font-size:17.5px;line-height:1.6;opacity:.92;max-width:34em;margin:0 auto 28px}
.lp2-cta{display:inline-block;background:#fff;color:#0F766E;font-weight:800;font-size:16.5px;padding:15px 34px;border-radius:12px;text-decoration:none}
.lp2-cta:hover{background:#ECFDF5}
.lp2-micro{font-size:13px;opacity:.75;margin:16px 0 0}
.lp2-pasos{background:#fff;padding:52px 0;font-family:system-ui,-apple-system,'Segoe UI',sans-serif}
.lp2-pasos .lp2-wrap{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
.lp2-paso{display:flex;gap:14px;align-items:flex-start}
.lp2-paso span{flex-shrink:0;width:34px;height:34px;border-radius:50%;background:#ECFDF5;color:#0F766E;font-weight:800;display:flex;align-items:center;justify-content:center;font-size:15px}
.lp2-paso h3{font-size:16.5px;margin:4px 0 4px;color:#0f172a}
.lp2-paso p{font-size:14.5px;color:#64748b;margin:0;line-height:1.55}
.lp2-form{background:#F1F5F9;padding:56px 0 66px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif}
.lp2-form-box{max-width:560px;background:#fff;border-radius:18px;padding:32px 30px;box-shadow:0 14px 40px rgba(15,23,42,.09)}
.lp2-form h2{font-size:25px;margin:0 0 20px;color:#0f172a;letter-spacing:-.5px}
.lp2-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.lp2-form label{display:block;font-size:12.5px;font-weight:700;color:#334155;margin-bottom:13px}
.lp2-form input,.lp2-form textarea{width:100%;margin-top:5px;padding:11px 13px;border:1.5px solid #E2E8F0;border-radius:10px;font-size:15px;font-family:inherit;outline:none;color:#0f172a}
.lp2-form input:focus,.lp2-form textarea:focus{border-color:#0F766E}
.lp2-btn{width:100%;background:#0F766E;color:#fff;border:0;padding:14px;border-radius:11px;font-size:16px;font-weight:700;font-family:inherit;cursor:pointer;margin-top:4px}
.lp2-btn:hover{background:#115E59}
@media(max-width:760px){
  .lp2-hero{padding:52px 0 46px}
  .lp2-hero h1{font-size:31px}
  .lp2-pasos .lp2-wrap{grid-template-columns:1fr;gap:20px}
  .lp2-row{grid-template-columns:1fr}
}`,
  },
  {
    id: 'guia',
    nombre: 'Descarga de guía',
    descripcion: 'Entrega algo de valor a cambio del correo. Para llenar la parte alta del embudo.',
    html: `
<section class="lp3">
  <div class="lp3-wrap">
    <div class="lp3-txt">
      <span class="lp3-tag">Guía gratuita · PDF</span>
      <h1>7 errores que encarecen tu arriendo (y cómo evitarlos)</h1>
      <p class="lp3-lead">Lo que revisamos en cada contrato antes de firmarlo. Doce páginas, sin relleno, escritas por quienes lo hacen todos los días.</p>
      <ul class="lp3-list">
        <li>Qué cláusulas negociar y cuáles no valen la pena</li>
        <li>Cómo calcular el costo real, más allá del canon</li>
        <li>La revisión de entrega que evita descuentos al salir</li>
      </ul>
    </div>
    <div class="lp3-form">
      <h2>Te la enviamos ahora</h2>
      <form data-gracias="¡Listo! Revisa tu correo, la guía va en camino.">
        <label>Nombre<input type="text" name="nombre" placeholder="Tu nombre" required></label>
        <label>Correo<input type="email" name="email" placeholder="tu@correo.com" required></label>
        <button type="submit" class="lp3-btn">Descargar la guía</button>
        <p class="lp3-nota">Un correo, sin spam. Puedes darte de baja cuando quieras.</p>
      </form>
    </div>
  </div>
</section>`,
    css: `
.lp3{background:#FAFAF9;padding:66px 0;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center}
.lp3-wrap{max-width:1020px;margin:0 auto;padding:0 22px;display:grid;grid-template-columns:1.15fr .85fr;gap:50px;align-items:center}
.lp3-tag{display:inline-block;background:#FEF3C7;color:#92400E;font-size:12px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;padding:6px 12px;border-radius:6px;margin-bottom:18px}
.lp3 h1{font-size:40px;line-height:1.13;letter-spacing:-1px;color:#1C1917;margin:0 0 16px;font-weight:800}
.lp3-lead{font-size:16.5px;line-height:1.65;color:#57534E;margin:0 0 24px;max-width:32em}
.lp3-list{list-style:none;padding:0;margin:0;display:grid;gap:12px}
.lp3-list li{position:relative;padding-left:26px;font-size:15px;color:#44403C;line-height:1.5}
.lp3-list li::before{content:'';position:absolute;left:0;top:8px;width:8px;height:8px;border-radius:2px;background:#D97706}
.lp3-form{background:#fff;border:1px solid #E7E5E4;border-radius:16px;padding:30px 28px;box-shadow:0 10px 34px rgba(28,25,23,.07)}
.lp3-form h2{font-size:21px;margin:0 0 20px;color:#1C1917;letter-spacing:-.4px}
.lp3-form label{display:block;font-size:12.5px;font-weight:700;color:#44403C;margin-bottom:14px}
.lp3-form input{width:100%;margin-top:5px;padding:11px 13px;border:1.5px solid #E7E5E4;border-radius:10px;font-size:15px;font-family:inherit;outline:none;color:#1C1917}
.lp3-form input:focus{border-color:#D97706}
.lp3-btn{width:100%;background:#1C1917;color:#fff;border:0;padding:14px;border-radius:11px;font-size:16px;font-weight:700;font-family:inherit;cursor:pointer}
.lp3-btn:hover{background:#292524}
.lp3-nota{font-size:11.5px;color:#A8A29E;text-align:center;margin:11px 0 0;line-height:1.5}
@media(max-width:820px){
  .lp3{padding:44px 0;min-height:0}
  .lp3-wrap{grid-template-columns:1fr;gap:32px}
  .lp3 h1{font-size:30px}
}`,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Bloques que se arrastran al lienzo.
//
// El preset de GrapesJS dejó de traer los suyos en la 1.0, así que el panel
// salía vacío: se podía editar lo que la plantilla ya tenía, pero no añadir
// una sección. Estos son los nuestros, y son mejores que los genéricos —
// «1 columna / texto / imagen» no le sirve a quien vende: lo que necesita es
// soltar una sección de testimonios ya hecha y cambiarle las palabras.
//
// Reglas al añadir un bloque:
//   · Cada uno lleva su propio <style>. Así se ve bien al soltarlo en
//     cualquier página, venga de la plantilla que venga. Las clases van con
//     prefijo lpb- para no pisar las de las plantillas.
//   · Nada de estilos en línea: el usuario tiene que poder cambiar el color
//     desde el panel de estilos sin pelear con la especificidad.
//   · Textos de ejemplo creíbles en español de LatAm. Se publican tal cual
//     más veces de las que uno cree.
//   · El icono es un SVG de 24 en trazo, como los de la aplicación.
// ─────────────────────────────────────────────────────────────────────────────

function lpbIcono(d) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round" class="gjs-block-svg" style="width:26px;height:26px">' + d + '</svg>';
}

window.LANDINGS_BLOQUES = [
  // ── Secciones ─────────────────────────────────────────────────────────────
  {
    id: 'lpb-portada',
    label: 'Portada',
    category: 'Secciones',
    icono: '<path d="M3 5h18v9H3z"/><path d="M7 18h10"/>',
    content: `
<style>
.lpb-portada{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#0F172A;color:#fff;padding:78px 22px;text-align:center}
.lpb-portada .lpb-wrap{max-width:760px;margin:0 auto}
.lpb-portada h1{font-size:42px;line-height:1.12;margin:0 0 16px;font-weight:800;letter-spacing:-.5px}
.lpb-portada p{font-size:18px;line-height:1.6;opacity:.85;margin:0 0 28px}
.lpb-portada .lpb-btn{display:inline-block;background:#fff;color:#0F172A;padding:15px 30px;border-radius:10px;font-weight:700;font-size:16px;text-decoration:none}
@media(max-width:600px){.lpb-portada{padding:52px 18px}.lpb-portada h1{font-size:30px}.lpb-portada p{font-size:16px}}
</style>
<section class="lpb-portada">
  <div class="lpb-wrap">
    <h1>El titular que hace que se queden a leer</h1>
    <p>Una sola frase que explique qué gana quien te contrate. Sin adjetivos de más y sin hablar de ti.</p>
    <a href="#formulario" class="lpb-btn">Quiero saber más</a>
  </div>
</section>`,
  },
  {
    id: 'lpb-beneficios',
    label: 'Beneficios',
    category: 'Secciones',
    icono: '<path d="M4 5h4v14H4z"/><path d="M10 5h4v14h-4z"/><path d="M16 5h4v14h-4z"/>',
    content: `
<style>
.lpb-benef{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#fff;padding:66px 22px}
.lpb-benef .lpb-wrap{max-width:1020px;margin:0 auto}
.lpb-benef h2{font-size:30px;text-align:center;margin:0 0 40px;color:#0F172A;font-weight:800}
.lpb-benef .lpb-cols{display:flex;gap:26px;flex-wrap:wrap}
.lpb-benef .lpb-col{flex:1;min-width:230px}
.lpb-benef .lpb-ic{width:42px;height:42px;border-radius:11px;background:#EEF0FD;color:#1E2BCC;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px;margin-bottom:13px}
.lpb-benef h3{font-size:18px;margin:0 0 7px;color:#0F172A}
.lpb-benef p{font-size:15px;line-height:1.65;color:#5A607A;margin:0}
@media(max-width:600px){.lpb-benef{padding:44px 18px}.lpb-benef h2{font-size:24px;margin-bottom:28px}}
</style>
<section class="lpb-benef">
  <div class="lpb-wrap">
    <h2>Por qué la gente nos elige</h2>
    <div class="lpb-cols">
      <div class="lpb-col"><div class="lpb-ic">01</div><h3>Sin perder tiempo</h3><p>Explica el primer motivo con una frase concreta. Un número siempre convence más que un adjetivo.</p></div>
      <div class="lpb-col"><div class="lpb-ic">02</div><h3>Alguien que responde</h3><p>El segundo motivo. Piensa en la objeción que más te repiten y respóndela aquí.</p></div>
      <div class="lpb-col"><div class="lpb-ic">03</div><h3>Sin sorpresas</h3><p>El tercero. Si puedes decir un plazo o un precio, dilo: la claridad vende.</p></div>
    </div>
  </div>
</section>`,
  },
  {
    id: 'lpb-formulario',
    label: 'Formulario',
    category: 'Secciones',
    icono: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h4"/>',
    content: `
<style>
.lpb-form{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#F7F8FC;padding:66px 22px}
.lpb-form .lpb-card{max-width:470px;margin:0 auto;background:#fff;border-radius:16px;padding:34px 30px;box-shadow:0 12px 40px -8px rgba(13,15,28,.16)}
.lpb-form h2{font-size:25px;margin:0 0 6px;color:#0F172A;font-weight:800}
.lpb-form .lpb-sub{font-size:15px;color:#5A607A;margin:0 0 22px}
.lpb-form label{display:block;font-size:13px;font-weight:600;color:#0F172A;margin-bottom:14px}
.lpb-form input,.lpb-form textarea{width:100%;margin-top:6px;padding:12px 13px;border:1.5px solid #E4E6F0;border-radius:9px;font-size:15px;font-family:inherit;color:#0F172A;background:#fff}
.lpb-form input:focus,.lpb-form textarea:focus{outline:none;border-color:#1E2BCC}
.lpb-form button{width:100%;margin-top:6px;background:#1E2BCC;color:#fff;border:0;padding:15px;border-radius:10px;font-size:16px;font-weight:700;font-family:inherit;cursor:pointer}
.lpb-form .lpb-nota{font-size:12px;color:#9DA3BE;text-align:center;margin:12px 0 0}
</style>
<section class="lpb-form" id="formulario">
  <div class="lpb-card">
    <h2>Cuéntanos qué necesitas</h2>
    <p class="lpb-sub">Te escribimos hoy mismo.</p>
    <form data-gracias="¡Listo! Te contactamos en las próximas horas.">
      <label>Nombre<input type="text" name="nombre" placeholder="Tu nombre" required></label>
      <label>WhatsApp<input type="tel" name="telefono" placeholder="300 000 0000" required></label>
      <label>Correo<input type="email" name="email" placeholder="tu@correo.com"></label>
      <label>¿En qué te ayudamos?<textarea name="mensaje" rows="3" placeholder="Cuéntanos brevemente"></textarea></label>
      <button type="submit">Quiero que me contacten</button>
      <p class="lpb-nota">Tus datos solo se usan para contactarte.</p>
    </form>
  </div>
</section>`,
  },
  {
    id: 'lpb-testimonio',
    label: 'Testimonios',
    category: 'Secciones',
    icono: '<path d="M8 10c0-2 1-3 3-3M8 10v4a2 2 0 0 0 2 2M8 10H6a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h1"/><path d="M17 10c0-2 1-3 3-3M17 10v4a2 2 0 0 0 2 2M17 10h-2a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h1"/>',
    content: `
<style>
.lpb-test{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#fff;padding:66px 22px}
.lpb-test .lpb-wrap{max-width:1020px;margin:0 auto}
.lpb-test h2{font-size:30px;text-align:center;margin:0 0 38px;color:#0F172A;font-weight:800}
.lpb-test .lpb-cols{display:flex;gap:22px;flex-wrap:wrap}
.lpb-test .lpb-t{flex:1;min-width:250px;background:#F7F8FC;border-radius:14px;padding:26px}
.lpb-test .lpb-t p{font-size:15.5px;line-height:1.7;color:#0F172A;margin:0 0 18px}
.lpb-test .lpb-quien{display:flex;align-items:center;gap:11px}
.lpb-test .lpb-ini{width:38px;height:38px;border-radius:50%;background:#1E2BCC;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px}
.lpb-test .lpb-nom{font-size:14px;font-weight:700;color:#0F172A}
.lpb-test .lpb-rol{font-size:12.5px;color:#5A607A}
@media(max-width:600px){.lpb-test{padding:44px 18px}.lpb-test h2{font-size:24px}}
</style>
<section class="lpb-test">
  <div class="lpb-wrap">
    <h2>Lo que dicen quienes ya trabajaron con nosotros</h2>
    <div class="lpb-cols">
      <div class="lpb-t"><p>Cambia esto por una frase real de un cliente. Las que funcionan cuentan un resultado, no un halago.</p><div class="lpb-quien"><div class="lpb-ini">MR</div><div><div class="lpb-nom">María Restrepo</div><div class="lpb-rol">Dueña, Panadería La Espiga</div></div></div></div>
      <div class="lpb-t"><p>Un segundo testimonio, mejor si menciona la objeción que tenía antes de contratarte y cómo se resolvió.</p><div class="lpb-quien"><div class="lpb-ini">JC</div><div><div class="lpb-nom">Julián Castaño</div><div class="lpb-rol">Gerente, Muebles del Norte</div></div></div></div>
    </div>
  </div>
</section>`,
  },
  {
    id: 'lpb-preguntas',
    label: 'Preguntas frecuentes',
    category: 'Secciones',
    icono: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3 2.45V14"/><path d="M12 17h.01"/>',
    content: `
<style>
.lpb-faq{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#F7F8FC;padding:66px 22px}
.lpb-faq .lpb-wrap{max-width:700px;margin:0 auto}
.lpb-faq h2{font-size:30px;text-align:center;margin:0 0 34px;color:#0F172A;font-weight:800}
.lpb-faq .lpb-q{background:#fff;border-radius:12px;padding:20px 22px;margin-bottom:12px}
.lpb-faq h3{font-size:16.5px;margin:0 0 7px;color:#0F172A}
.lpb-faq p{font-size:15px;line-height:1.65;color:#5A607A;margin:0}
@media(max-width:600px){.lpb-faq{padding:44px 18px}.lpb-faq h2{font-size:24px}}
</style>
<section class="lpb-faq">
  <div class="lpb-wrap">
    <h2>Preguntas frecuentes</h2>
    <div class="lpb-q"><h3>¿Cuánto cuesta?</h3><p>Responde con un rango o con «desde». Esquivar el precio hace que la gente se vaya a buscarlo a otro lado.</p></div>
    <div class="lpb-q"><h3>¿En cuánto tiempo veo resultados?</h3><p>Da un plazo honesto. Prometer de más aquí se paga después.</p></div>
    <div class="lpb-q"><h3>¿Qué pasa si no me sirve?</h3><p>Explica tu garantía o tu política. Quita el miedo antes de pedir los datos.</p></div>
  </div>
</section>`,
  },
  {
    id: 'lpb-cta',
    label: 'Llamado a la acción',
    category: 'Secciones',
    icono: '<rect x="3" y="7" width="18" height="10" rx="3"/><path d="M9 12h6"/>',
    content: `
<style>
.lpb-cta{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#1E2BCC;color:#fff;padding:60px 22px;text-align:center}
.lpb-cta h2{font-size:30px;margin:0 0 12px;font-weight:800}
.lpb-cta p{font-size:17px;opacity:.85;margin:0 0 26px}
.lpb-cta .lpb-btn{display:inline-block;background:#fff;color:#1E2BCC;padding:15px 32px;border-radius:10px;font-weight:700;font-size:16px;text-decoration:none}
@media(max-width:600px){.lpb-cta{padding:44px 18px}.lpb-cta h2{font-size:24px}}
</style>
<section class="lpb-cta">
  <h2>¿Empezamos?</h2>
  <p>Déjanos tus datos y te escribimos hoy mismo.</p>
  <a href="#formulario" class="lpb-btn">Quiero que me contacten</a>
</section>`,
  },
  {
    id: 'lpb-whatsapp',
    label: 'Botón de WhatsApp',
    category: 'Secciones',
    icono: '<path d="M4 20l1.4-4A8 8 0 1 1 8 18.6z"/><path d="M9 10.5c.6 2 2.5 3.4 4.5 3.9l.8-1.3 1.7.6"/>',
    content: `
<style>
.lpb-wa{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#fff;padding:44px 22px;text-align:center}
.lpb-wa a{display:inline-flex;align-items:center;gap:10px;background:#25D366;color:#fff;padding:15px 28px;border-radius:999px;font-weight:700;font-size:16px;text-decoration:none}
.lpb-wa .lpb-nota{font-size:13px;color:#5A607A;margin:12px 0 0}
</style>
<section class="lpb-wa">
  <a href="https://wa.me/573000000000" target="_blank" rel="noopener">Escríbenos por WhatsApp</a>
  <p class="lpb-nota">Cambia el número en el enlace: wa.me/57 y tu número, sin espacios ni signos.</p>
</section>`,
  },
  {
    id: 'lpb-pie',
    label: 'Pie de página',
    category: 'Secciones',
    icono: '<path d="M3 5h18v14H3z"/><path d="M3 15h18"/>',
    content: `
<style>
.lpb-pie{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#0F172A;color:#fff;padding:38px 22px;text-align:center}
.lpb-pie .lpb-nom{font-size:16px;font-weight:700;margin:0 0 6px}
.lpb-pie p{font-size:13.5px;opacity:.7;margin:0 0 4px;line-height:1.6}
.lpb-pie a{color:#fff;opacity:.7;text-decoration:none}
</style>
<footer class="lpb-pie">
  <p class="lpb-nom">Nombre de tu negocio</p>
  <p>Bogotá, Colombia · <a href="tel:+573000000000">300 000 0000</a></p>
  <p><a href="#">Política de privacidad</a></p>
</footer>`,
  },

  // ── Piezas sueltas ────────────────────────────────────────────────────────
  {
    id: 'lpb-titulo', label: 'Título', category: 'Piezas',
    icono: '<path d="M6 5v14M18 5v14M6 12h12"/>',
    content: '<h2 style="font-family:system-ui,-apple-system,sans-serif;font-size:30px;font-weight:800;color:#0F172A;text-align:center;margin:34px 22px">Escribe aquí tu título</h2>',
  },
  {
    id: 'lpb-texto', label: 'Texto', category: 'Piezas',
    icono: '<path d="M4 6h16M4 11h16M4 16h10"/>',
    content: '<p style="font-family:system-ui,-apple-system,sans-serif;font-size:16px;line-height:1.7;color:#5A607A;max-width:680px;margin:16px auto;padding:0 22px">Escribe aquí tu texto. Frases cortas y en segunda persona: se leen mejor en el celular, que es por donde va a entrar casi toda tu gente.</p>',
  },
  {
    id: 'lpb-imagen', label: 'Imagen', category: 'Piezas',
    icono: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5-5-9 8"/>',
    content: { type: 'image', style: { display: 'block', margin: '20px auto', 'max-width': '100%' }, activeOnRender: 1 },
  },
  {
    id: 'lpb-boton', label: 'Botón', category: 'Piezas',
    icono: '<rect x="3" y="8" width="18" height="8" rx="4"/>',
    content: `
<style>.lpb-solo{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;text-align:center;padding:18px 22px}
.lpb-solo a{display:inline-block;background:#1E2BCC;color:#fff;padding:14px 30px;border-radius:10px;font-weight:700;font-size:16px;text-decoration:none}</style>
<div class="lpb-solo"><a href="#formulario">Quiero que me contacten</a></div>`,
  },
  {
    id: 'lpb-lista', label: 'Lista con chulos', category: 'Piezas',
    icono: '<path d="M4 7l2 2 3-3M4 15l2 2 3-3M13 8h7M13 16h7"/>',
    content: `
<style>
.lpb-lista{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:680px;margin:20px auto;padding:0 22px;list-style:none}
.lpb-lista li{position:relative;padding-left:30px;margin-bottom:12px;font-size:16px;line-height:1.6;color:#0F172A}
.lpb-lista li::before{content:"";position:absolute;left:0;top:4px;width:18px;height:18px;border-radius:50%;background:#EEF0FD}
.lpb-lista li::after{content:"";position:absolute;left:5.5px;top:9px;width:7px;height:4px;border-left:2px solid #1E2BCC;border-bottom:2px solid #1E2BCC;transform:rotate(-45deg)}
</style>
<ul class="lpb-lista"><li>Primer motivo por el que deberían elegirte</li><li>Segundo motivo, mejor con un número</li><li>Tercer motivo, el que resuelve la duda de siempre</li></ul>`,
  },
  {
    id: 'lpb-dos', label: 'Dos columnas', category: 'Piezas',
    icono: '<rect x="3" y="5" width="8" height="14" rx="1"/><rect x="13" y="5" width="8" height="14" rx="1"/>',
    content: `
<style>
.lpb-dos{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;display:flex;gap:24px;flex-wrap:wrap;max-width:1020px;margin:24px auto;padding:0 22px}
.lpb-dos > div{flex:1;min-width:240px}
</style>
<div class="lpb-dos"><div><p style="font-size:16px;line-height:1.7;color:#5A607A;margin:0">Columna izquierda.</p></div><div><p style="font-size:16px;line-height:1.7;color:#5A607A;margin:0">Columna derecha.</p></div></div>`,
  },
  {
    id: 'lpb-video', label: 'Video', category: 'Piezas',
    icono: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5l5 2.5-5 2.5z"/>',
    content: { type: 'video', src: '', provider: 'yt', style: { display: 'block', width: '100%', 'max-width': '760px', height: '420px', margin: '24px auto' }, activeOnRender: 1 },
  },
  {
    id: 'lpb-separador', label: 'Separador', category: 'Piezas',
    icono: '<path d="M3 12h18"/>',
    content: '<hr style="border:0;border-top:1px solid #E4E6F0;max-width:680px;margin:32px auto">',
  },
];

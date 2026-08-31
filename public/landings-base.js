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

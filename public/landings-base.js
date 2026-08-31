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
];

// Notas al cerrar una oportunidad: node pruebas/cierre-con-nota.mjs
//
// Al marcar un negocio como ganado o perdido, el asesor puede dejar escrito lo
// que no cabe en el motivo: con qué descuento cerró, a nombre de quién va la
// factura, por qué se fue con la competencia.
//
// Lo que hay que proteger es el ORDEN. La nota se guarda ANTES de cerrar,
// porque es lo único de esa ventana que no se puede rehacer: el motivo está en
// un catálogo y el importe en la ficha, pero lo que acaba de escribir una
// persona no lo recuerda nadie. Al revés, si fallara la nota el negocio
// quedaría cerrado y lo escrito se habría perdido sin rastro.
//
// Y que no se duplique: si el cierre falla, el asesor va a volver a pulsar
// Confirmar, y la nota no puede guardarse dos veces.
//
// Se ejecuta la función de verdad contra un servidor de mentira.

import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const trozo = (desde, hasta) => {
  const a = js.indexOf(desde);
  if (a < 0) throw new Error('No encontré en app.js: ' + desde);
  return js.slice(a, js.indexOf(hasta, a));
};

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra ? ' → ' + extra : ''));
  if (!c) mal++;
};

const src = trozo('async function closeConfirm()', '\n// Muestra el cierre registrado');

// Monta closeConfirm con un DOM y una red de mentira. `fallan` dice qué
// peticiones tienen que salir mal.
async function cerrar({ nota = 'Cerró con 5% de descuento.', fallan = [], ctx = {} }) {
  const pasos = [];
  const campos = {
    'close-search': { value: 'Confianza y relación' },
    'close-date': { value: '2026-09-25' },
    'close-amount': { value: '2516000' },
    'close-currency': { value: 'COP' },
    'close-nota': { value: nota },
    'close-msg': { textContent: '' },
    'close-confirm': { disabled: false, textContent: 'Confirmar' },
    'close-modal': { remove: () => pasos.push('cierra-modal') },
  };
  const entorno = {
    _closeCtx: Object.assign({ leadId: 'l1', kind: 'won', stageKey: 'ganado', prevStage: 'propuesta' }, ctx),
    _closeReasons: { won: [{ id: 'r1', label: 'Confianza y relación' }], lost: [] },
    document: { getElementById: (id) => campos[id] || null },
    localStorage: { setItem: () => {}, getItem: () => null },
    crmLeads: [{ id: 'l1' }],
    crmRender: () => pasos.push('repinta'),
    crmDetailLead: { id: 'l1' },
    crmTraerActividades: async () => pasos.push('trae-historial'),
    lfPintar: () => pasos.push('pinta-historial'),
    showToast: (t) => pasos.push('toast'),
    closeLoadReasons: async () => {},
    fetchAuth: async (ruta, opts) => {
      const cuerpo = opts && opts.body ? JSON.parse(opts.body) : {};
      const quien = ruta.includes('lead-activities') ? (cuerpo.type === 'nota' ? 'nota' : 'etapa')
                  : ruta.includes('close-reasons') ? 'catalogo' : 'lead';
      pasos.push(quien);
      if (quien === 'nota') pasos.push('texto:' + cuerpo.content);
      if (fallan.includes(quien)) return { ok: false, status: 500 };
      return { ok: true, status: 200, json: async () => ({}) };
    },
  };
  const f = new Function(...Object.keys(entorno), src + '\n; return closeConfirm;');
  await f(...Object.values(entorno))();
  return { pasos, campos, ctx: entorno._closeCtx };
}

// ── El orden ───────────────────────────────────────────────────────────────
console.log('\nPrimero la nota, después el cierre');
let r = await cerrar({});
ok(r.pasos.indexOf('nota') > -1, 'se guarda la nota');
ok(r.pasos.indexOf('lead') > -1, 'y se cierra la oportunidad');
ok(r.pasos.indexOf('nota') < r.pasos.indexOf('lead'),
   'la nota va ANTES: si se invirtiera, una nota perdida cerraría el negocio igual',
   JSON.stringify(r.pasos));
ok(r.pasos.includes('texto:Cerró con 5% de descuento.'),
   'y se guarda lo que escribió, tal cual');

// ── Si la nota falla, NO se cierra ─────────────────────────────────────────
console.log('\nSi la nota no se puede guardar');
r = await cerrar({ fallan: ['nota'] });
ok(!r.pasos.includes('lead'),
   'la oportunidad NO se cierra: cerrar se puede reintentar, reescribir la nota no',
   JSON.stringify(r.pasos));
ok(/no se cerró la oportunidad/.test(r.campos['close-msg'].textContent),
   'y se dice con esas palabras', r.campos['close-msg'].textContent);
ok(r.campos['close-confirm'].disabled === false &&
   r.campos['close-confirm'].textContent === 'Confirmar',
   'el botón vuelve a estar disponible para reintentar');

// ── Si falla el cierre con la nota ya guardada ─────────────────────────────
console.log('\nSi falla el cierre y la nota ya estaba guardada');
r = await cerrar({ fallan: ['lead'] });
ok(/La nota quedó guardada/.test(r.campos['close-msg'].textContent),
   'se dice que la nota no se perdió', r.campos['close-msg'].textContent);
ok(r.ctx.notaGuardada === true,
   'y queda anotado que ya se guardó, para no repetirla al reintentar');

// El reintento de verdad: mismo contexto, la nota NO debe volver a salir.
const segundo = await cerrar({ ctx: { notaGuardada: true } });
ok(!segundo.pasos.includes('nota'),
   'al reintentar no se guarda otra vez: el historial tendría la frase repetida',
   JSON.stringify(segundo.pasos));
ok(segundo.pasos.includes('lead'), 'pero sí se cierra');

// ── Sin nota se cierra igual ───────────────────────────────────────────────
console.log('\nLa nota es opcional');
r = await cerrar({ nota: '' });
ok(!r.pasos.includes('nota'), 'sin escribir nada no se guarda una nota vacía');
ok(r.pasos.includes('lead'), 'y la oportunidad se cierra igual');
r = await cerrar({ nota: '   ' });
ok(!r.pasos.includes('nota'), 'y unos espacios tampoco cuentan como nota');

// ── Que lo escrito se vea sin recargar ─────────────────────────────────────
console.log('\nLo recién escrito aparece en la ficha');
r = await cerrar({});
ok(r.pasos.includes('trae-historial') && r.pasos.includes('pinta-historial'),
   'si la ficha está abierta se refresca: una nota que no aparece parece perdida');
r = await cerrar({ nota: '' });
ok(!r.pasos.includes('trae-historial'), 'y sin nota no se pide el historial para nada');

// ── También al perder ──────────────────────────────────────────────────────
console.log('\nTambién al marcar como perdida');
r = await cerrar({ ctx: { kind: 'lost', stageKey: 'perdido' }, nota: 'Se fue por precio.' });
ok(r.pasos.includes('texto:Se fue por precio.'),
   'el campo es el mismo en las dos: por qué se perdió importa tanto como por qué se ganó');

// ── En el HTML, la caja existe ─────────────────────────────────────────────
console.log('\nEl campo está en la ventana');
// Se ancla en un texto que SOLO está en esta ventana: hay más modales con el
// mismo patrón, y buscar por la clase cogía el primero que apareciera.
const modal = trozo('¿Marcar esta oportunidad como ganada?', 'document.body.appendChild(ov)');
ok(/id="close-nota"/.test(modal), 'hay una caja de texto para las notas');
ok(modal.indexOf('close-nota') > modal.indexOf('close-search'),
   'va después del motivo: el motivo es de catálogo, la nota es lo que no cabe ahí');
ok(/\(opcional\)/.test(modal), 'y se dice que es opcional, para que nadie se quede atascado');
ok(/rows="3"/.test(modal), 'con sitio para escribir varias líneas');

console.log('');
process.exit(mal ? 1 : 0);

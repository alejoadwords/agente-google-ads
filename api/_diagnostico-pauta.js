// api/_diagnostico-pauta.js — qué está mal y qué se puede mejorar en la pauta.
//
// Reglas, no IA: cada hallazgo tiene que poder explicarse con un número que el
// cliente pueda ir a comprobar en Google o en Meta. Un «tu campaña rinde mal»
// sin el porqué no se puede ni creer ni arreglar.
//
// Puro y sin red a propósito: recibe lo que api/pauta.js ya leyó de las redes y
// del CRM, y devuelve los hallazgos. Así se prueba entero con datos inventados.
//
// Solo propone UNA acción, pausar, y solo donde el dinero se está yendo sin
// resultado. Pausar no gasta; activar o subir presupuesto sí, y eso lo decide
// el cliente en la red, no un botón de aquí.

// Los umbrales, juntos y con su porqué. Se cambian aquí y en ningún otro sitio.
export const UMBRALES = {
  // Sin una sola impresión en 7 días estando activa: algo la frena.
  diasSinEntrega: 7,
  // «Gasta sin resultados» a partir de lo que costarían 3 leads al CPL medio de
  // la cuenta. Sin CPL medio (ningún lead aún), a partir de 50 clics: con menos
  // es pronto para concluir nada.
  leadsParaConcluir: 3,
  clicsParaConcluir: 50,
  // CPL de una campaña contra el promedio de la cuenta.
  cplAltoVeces: 2,
  cplBuenoVeces: 0.5,
  minLeadsComparar: 3,
  // CTR bajo en Meta. Por debajo de 0,5 % el anuncio casi no convence a nadie.
  ctrBajoMeta: 0.5,
  minImpresionesCtr: 1000,
  // Frecuencia en 7 días: más de 3,5 veces por persona es cansancio de anuncio.
  frecuenciaAlta: 3.5,
  // Un lead en proceso sin tocar más de 3 días se está enfriando.
  diasSinAtender: 3,
};

// Estados de cuenta de Meta que impiden entregar. 1 = activa.
const CUENTA_META = {
  2: 'desactivada',
  3: 'con un pago pendiente',
  7: 'en revisión de riesgo',
  8: 'con un pago pendiente de liquidar',
  9: 'en periodo de gracia por un pago',
  100: 'pendiente de cierre',
  101: 'cerrada',
};

const plata = (n, moneda) => {
  try {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: moneda || 'COP', maximumFractionDigits: 0 }).format(n);
  } catch { return '$' + Math.round(n).toLocaleString('es-CO'); }
};
// Objetivos de Meta que no persiguen leads: tráfico y alcance/reconocimiento.
const OBJETIVOS_SIN_LEADS = new Set(['OUTCOME_TRAFFIC', 'OUTCOME_AWARENESS', 'LINK_CLICKS', 'REACH', 'BRAND_AWARENESS', 'VIDEO_VIEWS', 'POST_ENGAGEMENT']);

const activa = (estado) => ['active', 'enabled'].includes(String(estado || '').toLowerCase());
const red = (r) => (r === 'google' ? 'Google' : 'Meta');

/**
 * @param o.cuentas    [{ red, conexion_id, nombre, estado_meta?, error? }]
 * @param o.campanas   filas de pauta.js ya unidas al CRM, más lo de los últimos 7
 *                     días: { red, conexion_id, id, nombre, estado, moneda,
 *                     inversion, impresiones, clics, conv, crm, cpl_real,
 *                     ultimos7: { impresiones, frecuencia } }
 * @param o.rechazados [{ red, conexion_id, campana_id, campana_nombre, anuncio, motivo }]
 * @param o.leads      leads del periodo con { campana_clave, stage, closed_at, updated_at, created_at }
 *                     (cada campaña trae `claves`: ['id:…', 'nom:…'] para casarlos)
 * @param o.ahora      Date (para las pruebas)
 * @returns [{ tipo: 'error'|'oportunidad'|'bien', gravedad, clave, red, campana, titulo, detalle, accion? }]
 */
export function diagnosticar({ cuentas = [], campanas = [], rechazados = [], leads = [], ahora = new Date() } = {}) {
  const U = UMBRALES;
  const out = [];
  const add = (h) => out.push(h);

  // ── Errores de cuenta ──────────────────────────────────────────────────────
  for (const c of cuentas) {
    if (c.red === 'meta' && c.estado_meta != null && Number(c.estado_meta) !== 1) {
      const que = CUENTA_META[Number(c.estado_meta)] || 'con un problema (estado ' + c.estado_meta + ')';
      add({
        tipo: 'error', gravedad: 'alta', clave: 'cuenta_bloqueada', red: 'meta', campana: null,
        titulo: 'La cuenta publicitaria «' + (c.nombre || '') + '» está ' + que,
        detalle: 'Mientras siga así, ninguna de sus campañas entrega. Se arregla en el Administrador de anuncios de Meta → Facturación o Calidad de la cuenta.',
      });
    }
  }

  // ── Anuncios rechazados ────────────────────────────────────────────────────
  const rechPorCampana = new Map();
  for (const a of rechazados) {
    const k = a.red + ':' + a.campana_id;
    if (!rechPorCampana.has(k)) rechPorCampana.set(k, []);
    rechPorCampana.get(k).push(a);
  }
  for (const lista of rechPorCampana.values()) {
    const a = lista[0];
    add({
      tipo: 'error', gravedad: 'alta', clave: 'anuncio_rechazado', red: a.red,
      campana: { id: a.campana_id, nombre: a.campana_nombre, conexion_id: a.conexion_id },
      titulo: lista.length === 1
        ? 'Un anuncio rechazado en «' + (a.campana_nombre || '') + '»'
        : lista.length + ' anuncios rechazados en «' + (a.campana_nombre || '') + '»',
      detalle: lista.slice(0, 3).map(x => (x.anuncio || 'Sin nombre') + (x.motivo ? ': ' + x.motivo : '')).join(' · ') +
        '. Un anuncio rechazado no entrega; corrígelo o reemplázalo en ' + red(a.red) + '.',
    });
  }

  // ── Por campaña ────────────────────────────────────────────────────────────
  // CPL medio de la cuenta: solo con las campañas que trajeron leads al CRM.
  const conLeads = campanas.filter(c => c.crm && c.crm.leads > 0 && c.inversion > 0);
  const invConLeads = conLeads.reduce((s, c) => s + c.inversion, 0);
  const leadsTot = conLeads.reduce((s, c) => s + c.crm.leads, 0);
  const cplMedio = leadsTot >= U.minLeadsComparar ? invConLeads / leadsTot : null;

  for (const c of campanas) {
    const camp = { id: c.id, nombre: c.nombre, conexion_id: c.conexion_id };
    const leadsCrm = (c.crm && c.crm.leads) || 0;
    const u7 = c.ultimos7 || null;

    // Activa y sin una impresión en 7 días.
    // Recién creada: todavía no ha tenido tiempo de salir. No es un fallo.
    const recien = c.creada && (ahora.getTime() - new Date(c.creada).getTime()) < 2 * 86400000;
    if (activa(c.estado) && u7 && Number(u7.impresiones || 0) === 0 && !recien) {
      const tieneRechazos = rechPorCampana.has(c.red + ':' + c.id);
      add({
        tipo: 'error', gravedad: 'alta', clave: 'no_entrega', red: c.red, campana: camp,
        titulo: '«' + c.nombre + '» está activa pero no ha salido en ' + U.diasSinEntrega + ' días',
        detalle: 'Cero impresiones en la última semana. ' + (tieneRechazos
          ? 'Tiene anuncios rechazados: empieza por ahí.'
          : 'Revisa en ' + red(c.red) + ' el método de pago, que tenga anuncios aprobados y que el público y el presupuesto no sean demasiado pequeños.'),
      });
      continue;   // sin entrega, el resto de reglas no significa nada
    }

    // Gasta sin traer ni un lead al CRM (ni conversiones en la red).
    const umbralGasto = cplMedio ? cplMedio * U.leadsParaConcluir : null;
    const gastoSuficiente = umbralGasto != null ? c.inversion >= umbralGasto : c.clics >= U.clicsParaConcluir && c.inversion > 0;
    // Solo a las campañas que buscan leads o ventas. Una de tráfico o de
    // alcance que no trae leads está haciendo lo que se le pidió: lo destapó
    // la campaña de tráfico de Acuarius, que salía como «gastó sin traer nada».
    const buscaLeads = !(c.red === 'meta' && OBJETIVOS_SIN_LEADS.has(String(c.objetivo || '').toUpperCase()));
    if (buscaLeads && leadsCrm === 0 && !Number(c.conv || 0) && gastoSuficiente) {
      add({
        tipo: 'error', gravedad: 'alta', clave: 'gasto_sin_leads', red: c.red, campana: camp,
        titulo: '«' + c.nombre + '» gastó ' + plata(c.inversion, c.moneda) + ' y no trajo ningún lead',
        detalle: (umbralGasto != null
          ? 'Con lo que gastó, al costo medio de tu cuenta tendrían que haber entrado unos ' + Math.floor(c.inversion / cplMedio) + ' leads.'
          : c.clics + ' clics y ningún lead: la gente llega pero no deja sus datos.') +
          ' Revisa que el formulario o la página funcionen, y que la campaña apunte al objetivo correcto.',
        // Solo si sigue activa: pausar lo que ya está en pausa no arregla nada.
        accion: activa(c.estado) ? { tipo: 'pausar', red: c.red, conexion_id: c.conexion_id, campana_id: c.id } : undefined,
      });
      continue;
    }

    // CPL muy por encima del promedio.
    if (cplMedio && leadsCrm >= 1 && c.cpl_real && c.cpl_real > cplMedio * U.cplAltoVeces) {
      add({
        tipo: 'oportunidad', gravedad: 'media', clave: 'cpl_alto', red: c.red, campana: camp,
        titulo: 'Cada lead de «' + c.nombre + '» cuesta ' + (c.cpl_real / cplMedio).toFixed(1).replace('.', ',') + ' veces el promedio',
        detalle: plata(c.cpl_real, c.moneda) + ' por lead, contra ' + plata(cplMedio, c.moneda) +
          ' de media en tu cuenta. Mover parte de su presupuesto a las campañas que convierten más barato te daría más leads con el mismo dinero.',
      });
    }

    // Lo que funciona: CPL muy por debajo, con leads suficientes para creerlo.
    if (cplMedio && leadsCrm >= U.minLeadsComparar && c.cpl_real && c.cpl_real < cplMedio * U.cplBuenoVeces) {
      add({
        tipo: 'bien', gravedad: 'baja', clave: 'cpl_bueno', red: c.red, campana: camp,
        titulo: '«' + c.nombre + '» trae leads a mitad de precio',
        detalle: plata(c.cpl_real, c.moneda) + ' por lead (' + leadsCrm + ' leads), contra ' + plata(cplMedio, c.moneda) +
          ' de media. Si su presupuesto se agota, es la primera candidata para crecer.',
      });
    }

    // CTR bajo (solo Meta: en Google mezclaría búsqueda con display).
    if (c.red === 'meta' && c.impresiones >= U.minImpresionesCtr) {
      const ctr = (c.clics / c.impresiones) * 100;
      if (ctr < U.ctrBajoMeta) {
        add({
          tipo: 'oportunidad', gravedad: 'media', clave: 'ctr_bajo', red: 'meta', campana: camp,
          titulo: 'Casi nadie hace clic en «' + c.nombre + '»',
          detalle: ctr.toFixed(2).replace('.', ',') + ' % de clics sobre ' + c.impresiones.toLocaleString('es-CO') +
            ' impresiones. Por debajo de ' + String(U.ctrBajoMeta).replace('.', ',') + ' % el anuncio no está convenciendo: prueba otra imagen o un primer renglón más directo.',
        });
      }
    }

    // Frecuencia alta en la última semana.
    if (c.red === 'meta' && u7 && Number(u7.frecuencia || 0) > U.frecuenciaAlta) {
      add({
        tipo: 'oportunidad', gravedad: 'media', clave: 'frecuencia_alta', red: 'meta', campana: camp,
        titulo: 'El público de «' + c.nombre + '» ya se cansó del anuncio',
        detalle: 'Cada persona lo vio ' + Number(u7.frecuencia).toFixed(1).replace('.', ',') +
          ' veces en 7 días. A partir de ' + String(U.frecuenciaAlta).replace('.', ',') + ' suele subir el costo y bajar la respuesta: renueva los creativos o amplía el público.',
      });
    }
  }

  // ── Leads de pauta sin atender ─────────────────────────────────────────────
  // El dinero ya se gastó; lo que se pierde ahora es el lead.
  const limite = ahora.getTime() - U.diasSinAtender * 86400000;
  const cerrado = (l) => l.closed_at || ['ganado', 'won', 'perdido', 'lost', 'descartado', 'cerrado'].includes(String(l.stage || '').toLowerCase());
  const frios = new Map();
  for (const l of leads) {
    if (!l.campana_clave || cerrado(l)) continue;
    const toque = new Date(l.updated_at || l.created_at).getTime();
    if (toque < limite) frios.set(l.campana_clave, (frios.get(l.campana_clave) || 0) + 1);
  }
  for (const c of campanas) {
    // Las claves las pone pauta.js con SU normalización del nombre: si aquí se
    // normalizara distinto, los leads de una campaña renombrada no casarían.
    const n = (c.claves || ['id:' + c.id]).reduce((s, k) => s + (frios.get(k) || 0), 0);
    if (!n) continue;
    add({
      tipo: 'oportunidad', gravedad: 'media', clave: 'leads_sin_atender', red: c.red,
      campana: { id: c.id, nombre: c.nombre, conexion_id: c.conexion_id },
      titulo: n === 1 ? 'Un lead de «' + c.nombre + '» lleva más de ' + U.diasSinAtender + ' días sin atender'
        : n + ' leads de «' + c.nombre + '» llevan más de ' + U.diasSinAtender + ' días sin atender',
      detalle: 'Ya pagaste por ellos. Un lead que nadie contacta en la primera semana casi nunca se recupera.',
    });
  }

  // Lo más grave primero; dentro de cada nivel, en el orden en que salieron.
  const peso = { alta: 0, media: 1, baja: 2 };
  const tipoPeso = { error: 0, oportunidad: 1, bien: 2 };
  return out
    .map((h, i) => ({ ...h, _i: i }))
    .sort((a, b) => tipoPeso[a.tipo] - tipoPeso[b.tipo] || peso[a.gravedad] - peso[b.gravedad] || a._i - b._i)
    .map(({ _i, ...h }) => h);
}

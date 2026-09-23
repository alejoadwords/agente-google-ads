// api/_gclid.js — de qué campaña vino un lead que solo trae el clic
//
// Google trae el auto-etiquetado activado por defecto: todo clic en un anuncio
// llega a la web del cliente con un `gclid` en la URL, aunque nadie haya
// etiquetado nada a mano. El formulario ya lo captura y lo guarda en el lead
// como «Clic de anuncio».
//
// Pero la pantalla de pauta une campañas y leads por `ID de campaña` o, en su
// defecto, por nombre. El gclid no lo miraba nadie. Resultado, en la cuenta de
// Certain: de 332 leads, 5 traían el clic de un anuncio de Google y los 5
// contaban como «sin campaña». La mitad azul de la pantalla, entera en cero.
//
// El gclid identifica el clic de forma única y Google sabe de qué campaña es:
// basta preguntárselo. Lo que se averigua se guarda EN EL LEAD, así que se
// pregunta una vez y el cruce normal por id funciona desde entonces.
//
// Dos límites de Google que mandan sobre el diseño:
//
//   · `click_view` solo guarda **90 días**. Más atrás no hay nada que pedir, y
//     pedirlo igual gasta llamadas para recibir vacío.
//   · Se consulta **un día a la vez**: `segments.date` tiene que ser una fecha
//     exacta. De ahí que los leads se agrupen por su día antes de preguntar.

export const DIAS_CLICK_VIEW = 90;
// Cuántos días distintos se consultan como mucho en una carga. Con una cuenta
// recién conectada puede haber meses de leads pendientes, y la pantalla no
// puede quedarse esperando noventa llamadas. Lo que no entra en esta carga se
// resuelve en la siguiente.
export const MAX_DIAS_POR_CARGA = 10;

// Marca de «se preguntó y Google no lo conoce». Sin esto, un gclid de un
// anuncio ya borrado se volvería a consultar en cada carga, para siempre.
export const SIN_CAMPANA = '_clic_sin_campana';

export function diaDe(iso) {
  return String(iso || '').slice(0, 10);
}

/** Leads que traen clic de Google y todavía no tienen campaña. */
export function pendientes(leads) {
  return (leads || []).filter((l) => {
    const cf = l.custom_fields || {};
    if (!String(cf['Clic de anuncio'] || '').trim()) return false;
    // Un fbclid también se guarda como «Clic de anuncio»; a Google no se le
    // pregunta por el clic de Meta.
    if (String(cf['Plataforma'] || '').trim() !== 'Google') return false;
    if (String(cf['ID de campaña'] || '').trim()) return false;
    if (String(cf['Campaña'] || '').trim()) return false;
    if (cf[SIN_CAMPANA]) return false;
    return true;
  });
}

/**
 * Resuelve la campaña de los leads que solo traen el gclid.
 *
 * Se le inyectan `consultarDia` y `guardar` en vez de hablar con Google y con
 * Supabase aquí dentro: así la prueba ejecuta esta misma función sin red.
 *
 * @param {object[]} o.leads         los del periodo, tal cual salen de la base
 * @param {function} o.consultarDia  (dia) => [{gclid, campaignId, campaignName}]
 * @param {function} o.guardar       (leadId, campos) => Promise
 * @param {number}   o.ahora         para poder fijar el día en la prueba
 * @returns {{resueltos, sin_campana, fuera_de_ventana, dias, pendientes}}
 */
export async function resolverClics({
  leads, consultarDia, guardar, ahora = Date.now(), maxDias = MAX_DIAS_POR_CARGA,
  // Con varias cuentas de Google conectadas, un clic pertenece a UNA sola y
  // las demás no lo conocen. Si la primera que se consulta lo marcara como
  // irresoluble, la que sí lo tiene no llegaría a verlo nunca. Solo marca la
  // última cuenta que se prueba.
  marcarSinCampana = true,
} = {}) {
  const cuenta = { resueltos: 0, sin_campana: 0, fuera_de_ventana: 0, dias: 0, pendientes: 0 };
  const porResolver = pendientes(leads);
  if (!porResolver.length) return cuenta;

  const limite = diaDe(new Date(ahora - DIAS_CLICK_VIEW * 864e5).toISOString());
  const porDia = new Map();
  for (const l of porResolver) {
    const dia = diaDe(l.created_at);
    // Más viejo que la ventana: no se puede resolver nunca. Se marca para no
    // volver a mirarlo en cada carga.
    if (!dia || dia < limite) {
      cuenta.fuera_de_ventana++;
      // Se marca en el objeto ADEMÁS de en la base, igual que abajo: si solo
      // se guarda, esta misma carga lo sigue viendo pendiente y la siguiente
      // cuenta de Google vuelve a intentarlo.
      const campos = { ...(l.custom_fields || {}), [SIN_CAMPANA]: true };
      l.custom_fields = campos;
      await guardar(l.id, campos).catch(() => {});
      continue;
    }
    if (!porDia.has(dia)) porDia.set(dia, []);
    porDia.get(dia).push(l);
  }

  // Los días más recientes primero: son los que el cliente está mirando.
  const dias = [...porDia.keys()].sort().reverse();
  const deEstaVez = dias.slice(0, maxDias);
  cuenta.pendientes = porDia.size > deEstaVez.length
    ? dias.slice(maxDias).reduce((s, d) => s + porDia.get(d).length, 0) : 0;

  for (const dia of deEstaVez) {
    let clics;
    try {
      clics = await consultarDia(dia);
      cuenta.dias++;
    } catch {
      // Un día que Google no contesta no puede tumbar los demás ni marcar
      // nada: se deja pendiente y se reintenta en la siguiente carga.
      cuenta.pendientes += porDia.get(dia).length;
      continue;
    }
    const mapa = new Map((clics || []).map(c => [String(c.gclid || ''), c]));
    for (const l of porDia.get(dia)) {
      const cf = l.custom_fields || {};
      const hallado = mapa.get(String(cf['Clic de anuncio'] || ''));
      if (!hallado?.campaignId && !marcarSinCampana) { cuenta.pendientes++; continue; }
      const campos = hallado && hallado.campaignId
        ? { ...cf, 'ID de campaña': String(hallado.campaignId), 'Campaña': String(hallado.campaignName || '') }
        : { ...cf, [SIN_CAMPANA]: true };
      // Se escribe también en el objeto que tenemos delante: sin esto, el
      // cruce de ESTA carga seguiría viendo el lead sin campaña y el cliente
      // tendría que recargar para ver el cambio que acaba de ocurrir.
      l.custom_fields = campos;
      if (hallado && hallado.campaignId) cuenta.resueltos++; else cuenta.sin_campana++;
      await guardar(l.id, campos).catch(() => {});
    }
  }
  return cuenta;
}

/** La consulta que Google entiende. Un solo día, que es lo que admite. */
export function consultaDelDia(dia) {
  return `SELECT click_view.gclid, campaign.id, campaign.name ` +
         `FROM click_view WHERE segments.date = '${dia}'`;
}

/** Aplana la respuesta de Google a lo que `resolverClics` espera. */
export function filasAClics(filas) {
  return (filas || []).map(f => ({
    gclid: f?.clickView?.gclid || '',
    campaignId: f?.campaign?.id || '',
    campaignName: f?.campaign?.name || '',
  })).filter(c => c.gclid);
}

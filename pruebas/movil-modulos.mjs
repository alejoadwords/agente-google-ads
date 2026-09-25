// Las siete pantallas de módulo: node pruebas/movil-modulos.mjs
//
// Chatbots, Campañas, Listas, Automatizaciones, Fuentes, Propuestas y Reservas
// enseñaban los datos de EJEMPLO a cuentas reales. A Certain le decían «3
// campañas este mes» y «Arriendos Envigado · 412 visitas», inventados los dos.
// Un cliente no tiene forma de saber que lo que lee no es suyo, y es
// exactamente el tipo de mentira que no se descubre sola.
//
// Aquí se comprueba que ahora traen lo de la cuenta, que las cuentas y los
// porcentajes salen de datos y no del aire, y que «no hay» y «no se pudo
// mirar» siguen siendo cosas distintas.

import { readFileSync } from 'node:fs';
import {
  cargarModulo, MODULOS_API, chipEstado,
  aCampana, aLista, aAutomatizacion, aFuente, aPropuesta, aServicio, aAgente,
} from '../public/movil-datos.js';

const AHORA = Date.parse('2026-09-24T12:00:00Z');
let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

console.log('\nEl chip de estado nunca se queda sin color\n');
{
  // El CSS solo tiene cuatro. Un estado que no caiga en uno se pinta sin fondo
  // y parece que la pantalla se rompió.
  const CSS = readFileSync(new URL('../public/movil-app.css', import.meta.url), 'utf8');
  const hay = [...CSS.matchAll(/\.estado-chip\.([a-z]+)\{/g)].map((m) => m[1]);
  const dela = ['sent', 'draft', 'queued', 'sending', 'paused', 'cancelled', 'viewed',
    'accepted', 'paid', 'active', 'inventado', '', null, undefined];
  const fuera = dela.map(chipEstado).filter((v) => !hay.includes(v));
  chk('los cuatro colores existen en el CSS', hay.length >= 4, hay.join(','));
  chk('todo estado de la API cae en uno de ellos', fuera.length === 0, fuera.join(','));
}

console.log('\nUna campaña dice lo que pasó, no lo que se supone\n');
{
  const c = aCampana({ name: 'Arriendos', channel: 'email', status: 'sent',
    stats: { total: 1000, sent: 900, delivered: 882, opened: 369, clicked: 108 } }, AHORA);
  chk('nombre y canal', c.nom === 'Arriendos' && /Correo/.test(c.sub), c.sub);
  chk('se dicen los enviados sobre el total', /900 de 1000/.test(c.sub), c.sub);
  chk('los porcentajes salen de los datos',
      c.res && c.res.Entregados === 98 && c.res.Abiertos === 41 && c.res.Clics === 12,
      JSON.stringify(c.res));
}
{
  // Un «0 %» sobre cero envíos se lee como una campaña que fracasó, cuando lo
  // que pasa es que todavía no ha salido.
  const b = aCampana({ name: 'Borrador', channel: 'email', status: 'draft' }, AHORA);
  chk('un borrador no inventa porcentajes', b.res === null);
  // El caso que de verdad pasa: la campaña YA tiene estadísticas, pero todavía
  // no ha salido ninguna. Dividir por cero da NaN, y tratar el cero como base
  // pinta «0 % entregados», que se lee como una campaña que fracasó.
  const cero = aCampana({ name: 'En cola', channel: 'email', status: 'queued',
    stats: { total: 100, sent: 0, delivered: 0, opened: 0, clicked: 0 } }, AHORA);
  chk('con cero envíos NO se pintan porcentajes', cero.res === null, JSON.stringify(cero.res));
  chk('y dice que no está programado', /sin programar/.test(b.sub), b.sub);
  const p = aCampana({ name: 'Futura', channel: 'whatsapp', status: 'queued',
    scheduled_at: '2026-09-30T14:00:00Z' }, AHORA);
  chk('una programada dice cuándo sale', /sale el/.test(p.sub), p.sub);
  chk('y no se pinta como borrador', p.est === 'activa', p.est);
  // Programada para AYER ya no es futura: decir «sale el 23» el 24 es mentir.
  const v = aCampana({ name: 'Vieja', channel: 'email', status: 'queued',
    scheduled_at: '2026-09-23T14:00:00Z' }, AHORA);
  chk('una programada que ya pasó no dice que va a salir', !/sale el/.test(v.sub), v.sub);
}

console.log('\nUn número inventado es peor que ninguno\n');
{
  // Una lista dinámica no tiene un número fijo de contactos: poner uno sería
  // inventarlo, y el móvil ya sabe no pintar el contador si no viene.
  const d = aLista({ name: 'Interesados', kind: 'dynamic' });
  chk('una lista dinámica no lleva contador', d.n === undefined, String(d.n));
  chk('y lo dice', /dinámica/i.test(d.sub), d.sub);
  const e = aLista({ name: 'Fija', kind: 'static', lead_ids: [1, 2, 3] });
  chk('una lista fija cuenta lo que tiene', e.n === 3, String(e.n));
  const x = aLista({ name: 'No escribir', kind: 'static', type: 'exclusion', lead_ids: [] });
  chk('una exclusión dice para qué sirve', /nunca reciben/.test(x.sub), x.sub);

  const f = aFuente({ label: 'Formulario', key: 'web', count: 31 });
  chk('una fuente con cuenta la enseña', f.n === 31, String(f.n));
  // 0 diría «esta fuente no trae a nadie», que no es lo mismo que no saberlo.
  const g = aFuente({ label: 'Portal', key: 'fincaraiz' });
  chk('una fuente sin cuenta NO se pinta con cero', g.n === undefined, String(g.n));
}

console.log('\nLo que está apagado se ve apagado\n');
{
  const a = aAutomatizacion({ name: 'NPS', is_active: true, trigger: 'stage_changed' });
  chk('una automatización encendida lo está', a.on === true);
  chk('y se lee su disparador', /stage changed/.test(a.sub), a.sub);
  const b = aAutomatizacion({ name: 'Dormidos', is_active: false, trigger: 'lead_inactive' });
  chk('una apagada lo dice, además del interruptor', b.on === false && /apagada/.test(b.sub), b.sub);
  // `active` en vez de `is_active`: los dos aparecen en la aplicación.
  chk('vale cualquiera de los dos nombres del campo',
      aAutomatizacion({ name: 'X', active: true }).on === true);

  const s = aServicio({ nombre: 'Visita', activo: false, duracion_min: 45 });
  chk('un servicio pausado avisa de que no se puede reservar',
      s.est === 'pausada' && /no se puede reservar/.test(s.sub), s.sub);

  const g = aAgente({ id: 'a1', name: 'Asesor', is_active: true, channel: 'whatsapp' });
  chk('un agente encendido lo está', g.on === true && g.id === 'a1');
  // El ejemplo decía «42 conversaciones este mes». La API no manda eso: si se
  // deja el texto, es un número inventado en la pantalla de un cliente.
  chk('no se inventa un recuento de conversaciones',
      !/\d/.test(g.convs), g.convs);
}

console.log('\nUna propuesta sin importe no vale cero\n');
{
  const p = aPropuesta({ title: 'Penthouse', lead_name: 'Paula', status: 'viewed',
    amount: 890000000, created_at: '2026-09-24T10:00:00Z' });
  chk('lleva el contacto delante', /^Paula · Penthouse/.test(p.nom), p.nom);
  chk('el importe va formateado', /890\.000\.000/.test(p.sub), p.sub);
  chk('vista cuenta como activa', p.est === 'activa', p.est);
  const q = aPropuesta({ title: 'Sin monto', status: 'draft' });
  chk('sin importe se dice, no se pinta «$ 0»', /Sin importe/.test(q.sub), q.sub);
}

console.log('\n«No hay» y «no se pudo mirar» siguen siendo distintos\n');
{
  const caido = async () => ({ ok: false, status: 500, json: async () => ({}) });
  chk('si la consulta falla viene null', (await cargarModulo(caido, 'campanas')) === null);

  const vacio = async () => ({ ok: true, json: async () => ({ campaigns: [] }) });
  const v = await cargarModulo(vacio, 'campanas');
  chk('si de verdad no hay, viene lista vacía', Array.isArray(v) && v.length === 0);

  // Una respuesta 200 con otra forma —un shell HTML, un cambio de contrato—
  // daría `undefined.map` y reventaría, o peor: una lista vacía que afirma que
  // la cuenta no tiene campañas. El catch-all de vercel.json devuelve justo eso.
  const raro = async () => ({ ok: true, json: async () => ({ otraCosa: [1, 2] }) });
  chk('una respuesta con otra forma es null, no una lista vacía',
      (await cargarModulo(raro, 'campanas')) === null);

  const explota = async () => { throw new Error('sin red'); };
  chk('un error de red devuelve null, no lanza', (await cargarModulo(explota, 'listas')) === null);

  chk('un módulo que no existe no revienta', (await cargarModulo(vacio, 'inventado')) === null);
}

console.log('\nLas rutas y las claves son las que usa la web\n');
{
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const ids = Object.keys(MODULOS_API);
  chk('no se quedó ninguno por el camino', ids.length >= 10, ids.join(','));
  for (const id of ids) {
    const { ruta, clave } = MODULOS_API[id];
    // Que la ruta exista no basta: la clave del JSON tiene que ser la misma que
    // lee app.js, o la lista viene vacía sin que nadie se entere.
    //
    // `clave: null` es el caso del endpoint que devuelve el arreglo pelado
    // —la academia—: ahí no hay clave que comparar, y exigir una haría que la
    // prueba pidiera inventarse uno.
    const claveOk = clave === null || new RegExp('\\.' + clave + '\\b').test(app);
    chk(id + ' usa la ruta y la clave de la web',
        app.includes(ruta) && claveOk, ruta + ' / ' + clave);
  }
  // Y que el caso del arreglo pelado esté de verdad contemplado, no sea que
  // alguien ponga null por descuido y se lea como «no se pudo mirar».
  const datos = readFileSync(new URL('../public/movil-datos.js', import.meta.url), 'utf8');
  // La ruta con puntos: sin ella cada endpoint que envuelve su lista —el
  // studio devuelve {data:{parrillas:[…]}}— necesitaría su caso especial, y el
  // que se olvide se lee como «no se pudo mirar» sobre una respuesta buena.
  chk('y las rutas con punto, para los que envuelven su lista',
      /split\('\.'\)\.reduce/.test(datos));
  // El filtro: en Aperturas solo tienen sentido las de correo que ya salieron.
  chk('y el filtro por módulo', /def\.filtro \? lista\.filter/.test(datos));
  chk('el cargador entiende el arreglo pelado', /def\.clave === null\s*\?\s*d\s*$/m.test(datos) || /def\.clave === null \? d :/.test(datos));
}

console.log('\nLos ejemplos no se cuelan en una cuenta real\n');
{
  const guion = readFileSync(new URL('../public/movil-app.js', import.meta.url), 'utf8');
  const codigo = guion.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  // El pintor solo puede usar `M.datos` —los ejemplos— cuando NO hay sesión.
  const i = codigo.indexOf('function pintarModulo');
  const fn = codigo.slice(i, codigo.indexOf('\n}', i));
  chk('los ejemplos van detrás de una comprobación de modo',
      /MODO !== 'real'/.test(fn) && fn.indexOf("MODO !== 'real'") < fn.indexOf('M.datos'),
      fn.slice(0, 120));
  chk('y cuando se usan, se dice que son ejemplos',
      /Datos de ejemplo/.test(fn));
  // Los agentes se enseñaban desde la lista inventada aunque la cuenta fuera
  // real. En cuanto hay sesión, BOTS deja de ser el ejemplo.
  chk('los agentes de ejemplo se descartan al entrar con cuenta',
      /BOTS = null;/.test(codigo), 'BOTS sigue apuntando al ejemplo');
  chk('y se piden los de verdad', /cargarModuloReal\('chatbots'\)/.test(codigo));
  // Un módulo sin fuente propia tampoco puede enseñar ejemplos como si nada.
  chk('un módulo sin API lo dice en vez de inventar',
      /todavía no trae tus datos/i.test(fn), fn.slice(-200));
}

console.log('\nAperturas y parrillas, con sus números\n');
{
  const c = (o) => ({ ok: true, json: async () => o });
  // La base son los ENTREGADOS, no los enviados: medir sobre lo que rebotó
  // castiga a la campaña por un correo que nunca llegó.
  const ap = await cargarModulo(async () => c({ campaigns: [
    { name: 'Salió', channel: 'email', status: 'sent',
      stats: { sent: 100, delivered: 98, opened: 41, clicked: 12 } },
  ] }), 'aperturas');
  chk('el porcentaje se mide sobre los entregados', ap[0].n === 42, String(ap[0].n));
  chk('y la unidad lo dice, no «contactos»', ap[0].nu === undefined || ap[0].nu !== 'contactos');
  chk('se ve sobre cuántos', /41 de 98 entregados/.test(ap[0].sub), ap[0].sub);

  // Solo las de correo que YA salieron: en un borrador no hay nada que abrir,
  // y en WhatsApp no hay apertura que medir.
  const mezcla = await cargarModulo(async () => c({ campaigns: [
    { name: 'Salió', channel: 'email', status: 'sent', stats: { sent: 10, delivered: 10, opened: 5 } },
    { name: 'Borrador', channel: 'email', status: 'draft' },
    { name: 'WhatsApp', channel: 'whatsapp', status: 'sent', stats: { sent: 50 } },
    { name: 'Sin envíos', channel: 'email', status: 'sent', stats: { sent: 0 } },
  ] }), 'aperturas');
  chk('solo entran las de correo que ya salieron',
      mezcla.length === 1 && mezcla[0].nom === 'Salió', mezcla.map((x) => x.nom).join(','));

  // Una parrilla cuyos posts no vinieron no tiene «0 publicaciones».
  const par = await cargarModulo(async () => c({ data: { parrillas: [
    { name: 'Octubre', posts: [1, 2, 3] },
    { name: 'Sin cargar' },
  ] } }), 'studio');
  chk('la parrilla cuenta sus publicaciones', /3 publicaciones/.test(par[0].sub), par[0].sub);
  chk('y sin ellas NO dice cero', !/0 publicaciones/.test(par[1].sub), par[1].sub);

  // El equipo, para la pantalla de Configuración.
  const eq = await cargarModulo(async () => c({ members: [
    { member_name: 'Maira', role: 'vendedor', status: 'active' },
    { member_email: 'x@y.co', role: 'admin', status: 'invited' },
  ] }), 'ajustes');
  chk('el equipo sale con su perfil', /vendedor/.test(eq[0].sub), eq[0].sub);
  chk('quien cae al correo no queda «sin nombre»', eq[1].nom === 'x@y.co', eq[1].nom);
  chk('y un estado que no es activo se dice', /invited/.test(eq[1].sub), eq[1].sub);
  // Sin el id del usuario la pantalla se pinta igual, pero no se le puede
  // asignar un contacto a nadie: el desplegable tendría nombres sin destino.
  chk('cada miembro lleva su id', eq[0].id === undefined ? false : true, JSON.stringify(eq[0]));
  chk('y si está activo o no', eq[0].activo === true && eq[1].activo === false);
}

console.log('\nEl NPS, ejecutado con respuestas de verdad\n');
{
  const guion = readFileSync(new URL('../public/movil-app.js', import.meta.url), 'utf8');
  const CIERRE = '})();';
  const conAsidero = guion.trimEnd().slice(0, -CIERRE.length) + `
    window.__nps = function(d){ MODULO_CACHE.nps = d; MODO = 'real'; return PINTORES.nps(); };
  ` + CIERRE;
  const g = { addEventListener(){}, matchMedia: () => ({matches:true}) };
  const el = () => ({ innerHTML:'', className:'', id:'', style:{}, dataset:{}, hidden:false,
    classList:{add(){},remove(){},toggle(){},contains(){return false}}, setAttribute(){},
    appendChild(){}, remove(){}, addEventListener(){}, querySelector:()=>el(),
    querySelectorAll:()=>[], getBoundingClientRect:()=>({width:0}) });
  const ent = { window: new Proxy(g,{has:()=>true,get:(t,k)=>t[k],set:(t,k,v)=>(t[k]=v,true)}),
    document:{querySelector:()=>el(),querySelectorAll:()=>[],getElementById:()=>el(),
      createElement:()=>el(),addEventListener(){},body:el(),head:el(),readyState:'complete'},
    navigator:{}, history:{pushState(){}}, setTimeout:()=>1, clearTimeout:()=>{},
    setInterval:()=>1, console:{warn(){},error(){},log(){}} };
  const n = Object.keys(ent);
  new Function(...n, conAsidero)(...n.map((k) => ent[k]));

  // Sin encuestas enviadas no es un NPS de cero: es que no hay nada que medir.
  chk('sin encuestas lo dice', /Todavía no has enviado/.test(g.__nps({ sent: 0, answered: 0 })));
  // Enviadas pero sin responder tampoco: un 0 ahí se lee «te califican regular».
  const mudo = g.__nps({ sent: 12, answered: 0, nps: null, promoters: 0, passives: 0, detractors: 0 });
  chk('enviadas y sin responder se distingue de un cero', /nadie ha respondido/.test(mudo), mudo.slice(0, 120));
  chk('y dice cuántas se enviaron', /Enviaste 12 encuestas/.test(mudo));

  const bueno = g.__nps({ sent: 20, answered: 10, nps: 60, promoters: 7, passives: 2, detractors: 1, comments: [] });
  chk('pinta el número', /nps-num[^>]*>60</.test(bueno), bueno.slice(0, 160));
  chk('y sobre cuántas respuestas', /10 de 20 respondieron/.test(bueno));
  chk('un NPS alto va en verde', /class="nps-num ">/.test(bueno), bueno.slice(0, 120));

  const tibio = g.__nps({ sent: 9, answered: 9, nps: 20, promoters: 4, passives: 3, detractors: 2 });
  chk('uno mediano va en ámbar', /nps-num tibio/.test(tibio));
  const malo = g.__nps({ sent: 9, answered: 9, nps: -30, promoters: 1, passives: 2, detractors: 6 });
  chk('y uno negativo en rojo', /nps-num malo/.test(malo));
  // Un NPS negativo es un número válido: no puede caer al «—» de «no se sabe».
  chk('el negativo se pinta, no se esconde', /nps-num malo">-30</.test(malo), malo.slice(0, 160));
  // El CERO es el que muerde: `d.nps || null` lo convierte en «no se sabe», y
  // un NPS de 0 es un dato real —tantos promotores como detractores—.
  const cero = g.__nps({ sent: 8, answered: 8, nps: 0, promoters: 3, passives: 2, detractors: 3 });
  chk('un NPS de cero es un dato, no un «no se sabe»',
      /nps-num tibio">0</.test(cero) && !/>—</.test(cero), cero.slice(0, 160));

  chk('null es «no se pudo», con reintento',
      /No se pudo traer/.test(g.__nps(null)) && /reintentarModulo/.test(g.__nps(null)));
  chk('y mientras llega lo dice', /Trayendo tus respuestas/.test(g.__nps(undefined)));
  // Sin sesión no hay nada que pedir: quedarse en «Trayendo…» para siempre se
  // lee como que la pantalla se colgó.
  const guionTxt = readFileSync(new URL('../public/movil-app.js', import.meta.url), 'utf8');
  chk('sin sesión no se queda colgado en «Trayendo…»',
      /Entra con tu cuenta para ver tu satisfacción/.test(guionTxt)
      && /Entra con tu cuenta para ver los videos/.test(guionTxt));

  const conComentarios = g.__nps({ sent: 5, answered: 3, nps: 33, promoters: 2, passives: 0, detractors: 1,
    comments: [{ score: 9, comment: 'Muy bien atendido', name: 'Ana' }] });
  chk('los comentarios salen con quién y qué nota', /Ana · 9\/10/.test(conComentarios));
  chk('y su texto', /Muy bien atendido/.test(conComentarios));
}

console.log('\nSEO dice POR QUÉ no se trae sola\n');
{
  const guion = readFileSync(new URL('../public/movil-app.js', import.meta.url), 'utf8');
  const codigo = guion.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  // `/api/seo-rank` es solo POST: leer una posición dispara una consulta que se
  // paga. Abrirla en el bolsillo gastaría dinero sin que nadie lo pidiera.
  const i = codigo.indexOf('seo: function');
  const fn = codigo.slice(i, codigo.indexOf('\n  }', i));
  chk('explica el motivo, no dice «no disponible»', /cuesta una consulta cada vez/.test(fn), fn.slice(0, 120));
  chk('y dice dónde se pide', /desde el computador/.test(fn));
  chk('no llama al endpoint por su cuenta', !/seo-rank/.test(codigo));
}

console.log('\nUna cabecera que afirma un número tiene que contarlo\n');
{
  const guion = readFileSync(new URL('../public/movil-app.js', import.meta.url), 'utf8');
  const codigo = guion.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  // El subtítulo decía «Últimos 30 días» sobre un embudo que no filtra por
  // fecha, y «3 clientes» sobre una cartera de cualquier tamaño. Nadie lo mira
  // dos veces, y por eso una cabecera es el mejor sitio para una mentira.
  chk('el subtítulo pasa por una función, no por la lista fija',
      /esc\(subtituloModulo\(id, t\[1\]\)\)/.test(codigo));
  const i = codigo.indexOf('function subtituloModulo');
  const fn = codigo.slice(i, codigo.indexOf('\n}', i));
  chk('en modo real no usa el texto de ejemplo', /MODO !== 'real'/.test(fn));
  chk('el del embudo no promete un plazo que no filtra', !/30 días/.test(fn));
  // Lo que no se puede contar se calla, en vez de arrastrar el número viejo.
  chk('lo que no sabe contar queda en blanco', /return '';\n\}/.test(codigo.slice(i)));
  chk('y ya no queda el plazo falso en el catálogo', !/Últimos 30 días/.test(codigo));
}

console.log('\nEl embudo, ejecutado con leads de verdad\n');
{
  // Mirar el código no basta: un cálculo puede existir y dar el número
  // equivocado. Aquí se EJECUTA el pintor contra leads inventados por la
  // prueba y se comprueban las cifras una a una.
  const guion = readFileSync(new URL('../public/movil-app.js', import.meta.url), 'utf8');
  const CIERRE = '})();';
  const conAsidero = guion.trimEnd().slice(0, -CIERRE.length) + `
    window.__pintar = function(leads, tablero){
      LEADS = leads; pipelineActual = tablero || null; MODO = 'real';
      return PINTORES.analisis();
    };
    window.__sub = function(id, clientes, tablero){
      MODO = 'real';
      // A pelo, no por window: clientesDeLaWeb() lee el nombre suelto, y en este
      // banco window es un PARÁMETRO, no el objeto global. Ponerlo ahí no lo
      // hace visible: es la misma trampa del let que ya nos costó una.
      globalThis.agencyClients = clientes || [];
      pipelineActual = tablero || null;
      PIPELINES = tablero ? [{ id: tablero, nom: 'Arriendo' }] : null;
      return subtituloModulo(id, 'TEXTO DE EJEMPLO');
    };
  ` + CIERRE;
  const g = { addEventListener(){}, matchMedia: () => ({matches:true}) };
  const el = () => ({ innerHTML:'', className:'', id:'', style:{}, dataset:{}, hidden:false,
    classList:{add(){},remove(){},toggle(){},contains(){return false}},
    setAttribute(){}, appendChild(){}, remove(){}, addEventListener(){},
    querySelector:()=>el(), querySelectorAll:()=>[], getBoundingClientRect:()=>({width:0}) });
  const ent = { window: new Proxy(g,{has:()=>true,get:(t,k)=>t[k],set:(t,k,v)=>(t[k]=v,true)}),
    document:{querySelector:()=>el(),querySelectorAll:()=>[],getElementById:()=>el(),
      createElement:()=>el(),addEventListener(){},body:el(),head:el(),readyState:'complete'},
    navigator:{}, history:{pushState(){}}, setTimeout:()=>1, clearTimeout:()=>{},
    setInterval:()=>1, console:{warn(){},error(){},log(){}} };
  const nombres = Object.keys(ent);
  new Function(...nombres, conAsidero)(...nombres.map((n) => ent[n]));

  const L = (etapa, pipeline) => ({ id: Math.random(), etapa, pipeline: pipeline || 'p1', tags: [] });
  const html = g.__pintar([
    L('nuevo'), L('nuevo'), L('nuevo'),
    L('contactado'),
    L('ganado'),
    L('perdido'), L('perdido'), L('perdido'),
  ]);
  chk('cuenta todos los contactos', /<b>8<\/b><span>/.test(html), html.slice(0, 200));
  // La tasa de cierre es ganados/TOTAL, la MISMA fórmula que
  // `crmRenderAnalytics`. Antes el móvil la medía sobre lo cerrado: un número
  // más justo, pero distinto con el mismo nombre en las dos pantallas, y eso
  // es peor — no se puede creer a ninguna de las dos.
  chk('la tasa de cierre coincide con la de la web: 1 de 8 = 13%',
      /13% de cierre/.test(html), html.slice(0, 460));

  // El alcance: si el informe contara los de otro tablero, diría un número
  // distinto que el CRM de al lado.
  const dos = [L('nuevo','p1'), L('nuevo','p1'), L('ganado','p2')];
  chk('con un tablero elegido solo cuenta los suyos',
      /<b>2<\/b><span>/.test(g.__pintar(dos, 'p1')), g.__pintar(dos, 'p1').slice(0, 160));
  chk('y sin tablero los cuenta todos',
      /<b>3<\/b><span>/.test(g.__pintar(dos, null)));

  // Una etapa que no está en nuestro catálogo no puede desaparecer.
  const rara = g.__pintar([L('nuevo'), L('en-veremos'), L('en-veremos')]);
  chk('una etapa propia de la cuenta aparece en el embudo', /en-veremos/.test(rara), rara.slice(0, 400));

  chk('sin leads lo dice, no pinta un embudo vacío',
      /Todavía no hay contactos/.test(g.__pintar([])));

  // ── Los MISMOS informes que la web ──
  // `crmRenderAnalytics` pinta cuatro KPI, embudo con valor, fuentes,
  // etiquetas y «requieren atención». El móvil traía solo el embudo.
  const V = (etapa, valor, extra) => Object.assign(
    { id: 'l' + Math.random(), etapa, pipeline: 'p1', valorNum: valor || 0, tags: [],
      cerrado: etapa === 'ganado' || etapa === 'perdido', origen: 'web', tocado: Date.now(), nom: 'X' },
    extra || {});
  const inf = g.__pintar([
    V('nuevo', 1000), V('contactado', 2000), V('propuesta', 7000),
    V('ganado', 5000), V('perdido', 3000),
  ]);
  chk('cuenta activos y ganados', /3 activos · 1 ganados/.test(inf), inf.slice(0, 260));
  // En proceso = los ABIERTOS. Meter los ganados ahí infla el pipeline con
  // plata que ya entró, y meter los perdidos con plata que nunca va a entrar.
  chk('«en proceso» suma solo los abiertos', /\$ 10\.000<\/b><span>en proceso/.test(inf), inf.slice(0, 400));
  chk('lo ganado se suma aparte', /\$ 5\.000<\/b><span>ganado/.test(inf));
  // Tasa de cierre = ganados / TOTAL, igual que la web. Medirla sobre lo
  // cerrado daba otro número con el mismo nombre en las dos pantallas.
  chk('la tasa de cierre es sobre el total, como en la web', /20% de cierre/.test(inf), inf.slice(0, 500));
  chk('el promedio es por negocio abierto', /\$ 3\.333<\/b><span>promedio/.test(inf), inf.slice(0, 560));
  chk('el embudo lleva el valor de cada etapa', /Propuesta<\/b><span>1 · \$ 7\.000/.test(inf), inf.slice(0, 900));
  chk('y están las fuentes', /Fuentes de leads/.test(inf));

  const conTags = g.__pintar([V('nuevo', 0, { tags: ['arriendo', 'urgente'] }), V('nuevo', 0, { tags: ['arriendo'] })]);
  chk('las etiquetas se cuentan', /Leads por etiqueta/.test(conTags) && /arriendo<\/span>/.test(conTags));

  // «Requieren atención»: 7 días o más sin tocar, ni cerrados ni con tarea.
  const viejo = Date.now() - 12 * 86400000;
  const dormido = g.__pintar([
    V('contactado', 0, { id: 'dormido', nom: 'Sin tocar', tocado: viejo }),
    V('ganado', 0, { id: 'cerrado', nom: 'Ya cerrado', tocado: viejo }),
  ]);
  chk('los dormidos salen con sus días', /Requieren atención/.test(dormido) && /12d/.test(dormido), dormido.slice(-400));
  // Un lead cerrado hace un mes no «requiere atención»: ya se resolvió.
  chk('un cerrado no aparece ahí', !/Ya cerrado/.test(dormido));
  chk('y se puede abrir desde el informe', /M\.abrirLead\('dormido'\)/.test(dormido));

  const fresco = g.__pintar([V('contactado', 0, { tocado: Date.now() })]);
  chk('lo tocado hoy no requiere atención', !/Requieren atención/.test(fresco));
  chk('y null es «no se pudo traer»',
      /No se pudieron traer/.test(g.__pintar(null)));

  // Los subtítulos, contados de verdad. Mirar que la línea del conteo exista
  // no basta: se puede dejar la línea y devolver otra cosa —lo comprobé—.
  const C = (n) => Array.from({ length: n }, (_, i) => ({ id: 'c' + i, name: 'Cliente ' + i }));
  chk('la cartera cuenta los clientes que hay', g.__sub('clientes', C(2)) === '2 clientes', g.__sub('clientes', C(2)));
  chk('y con uno lo dice en singular', g.__sub('clientes', C(1)) === '1 cliente', g.__sub('clientes', C(1)));
  chk('sin clientes dice cero, no un número viejo', g.__sub('clientes', C(0)) === '0 clientes', g.__sub('clientes', C(0)));
  chk('el embudo dice el tablero que estás viendo',
      g.__sub('analisis', C(0), 'p1') === 'Arriendo', g.__sub('analisis', C(0), 'p1'));
  chk('y sin tablero elegido lo dice también',
      g.__sub('analisis', C(0), null) === 'Todos los tableros', g.__sub('analisis', C(0), null));
  // Una pantalla que no sabe contar se calla, en vez de arrastrar el ejemplo.
  chk('la que no sabe contar no enseña el texto de ejemplo',
      g.__sub('seo', C(0)) === '', g.__sub('seo', C(0)));
}

console.log('\nEl embudo y la cartera salen de datos, no de una lista fija\n');
{
  const guion = readFileSync(new URL('../public/movil-app.js', import.meta.url), 'utf8');
  const codigo = guion.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  // Antes el informe decía 573 leads, 3% y 190 sin contactar a CUALQUIER
  // cuenta, y remataba acusando de un cuello de botella que quizá no tenía.
  chk('las listas de ejemplo del informe ya no existen',
      !/var EMBUDO = \[/.test(codigo) && !/var CARTERA = \[/.test(codigo));
  const i = codigo.indexOf('analisis: function');
  const fn = codigo.slice(i, codigo.indexOf('\n  },', i));
  chk('el embudo se calcula de LEADS', /LEADS\.filter/.test(fn), fn.slice(0, 100));
  // Mismo alcance que la pantalla de CRM: si dijera otro número que el CRM de
  // al lado, no se podría creer a ninguno de los dos.
  chk('y respeta el tablero elegido', /!pipelineActual \|\| l\.pipeline === pipelineActual/.test(fn));
  chk('null es «no se pudo», no cero', /LEADS === null/.test(fn));
  // La MISMA fórmula que `crmRenderAnalytics` en la web: ganados sobre el
  // total. Un número distinto con el mismo nombre en dos pantallas es peor
  // que un número imperfecto.
  chk('la tasa de cierre usa la fórmula de la web',
      /ganados\.length \/ ls\.length/.test(fn), fn.slice(0, 200));
  // Y los importes: lo abierto y lo ganado no se mezclan.
  chk('lo en proceso y lo ganado se suman por separado',
      /plataGan \+=/.test(fn) && /plataAct \+=/.test(fn));
  // Una etapa que el cliente inventó no puede desaparecer del informe.
  chk('las etapas propias de la cuenta también salen', /Object\.keys\(cuenta\)/.test(fn));
  // «Requieren atención» usa la regla de la web: 7 días o más sin tocar, ni
  // cerrados ni con tarea pendiente. Contar uno que ya tiene su llamada
  // agendada lo pone en rojo por un trabajo que alguien ya hizo.
  chk('los dormidos excluyen los cerrados y los que ya tienen tarea',
      /l\.cerrado \|\| conTarea\[l\.id\]/.test(fn), fn.slice(0, 200));
  chk('y el corte son 7 días, como en la web', /86400000\) >= 7/.test(fn));

  const j = codigo.indexOf('clientes: function');
  const fc = codigo.slice(j, codigo.indexOf('\n  },', j));
  chk('la cartera sale de la lista real', /clientesDeLaWeb\(\)/.test(fc));
  // Los leads en memoria son solo los del cliente ACTIVO: un contador al lado
  // de los demás sería un número sacado del aire.
  chk('y NO inventa contadores por cliente', !/leads|LEADS/.test(fc), 'cuenta leads que no tiene');
  chk('se ve cuál estás mirando', /viendo ahora/.test(fc));
  chk('y tocar otro cambia de cliente', /M\.elegirCliente/.test(fc));
}

console.log('\nLos módulos con pintor propio tampoco enseñan ejemplos\n');
{
  const guion = readFileSync(new URL('../public/movil-app.js', import.meta.url), 'utf8');
  const codigo = guion.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  // Esta rama se escapó al enchufar los otros: pintaba los EJEMPLOS sin mirar
  // el modo, así que a una cuenta real le enseñaba embudos, notas de NPS y
  // posiciones de SEO inventadas. Siete pantallas más diciendo lo que no es.
  const i = codigo.indexOf('if (!M && PINTORES[id])');
  const rama = i < 0 ? '' : codigo.slice(i, codigo.indexOf('return;', i));
  // La forma de la condición cambió —ahora hay pintores que SÍ traen datos—,
  // pero lo que no puede faltar es que la rama mire el modo antes de pintar.
  chk('la rama de pintor propio mira el modo antes de pintar',
      /\bMODO\b/.test(rama), rama.slice(0, 120));
  // Ya no vale «en modo real no se pinta ninguno»: `analisis` y `clientes`
  // trabajan con datos de verdad. Lo que sigue sin poder pasar es que se pinte
  // uno que NO los tiene.
  chk('en modo real solo se pintan los que traen datos reales',
      /PINTORES_REALES\[id\]/.test(rama), rama.slice(0, 160));
  const reales = (codigo.match(/var PINTORES_REALES = \{([^}]*)\}/) || [, ''])[1].match(/[a-z]+(?=:)/g) || [];
  chk('y la lista de los que sí los traen no está vacía', reales.length > 0, reales.join(','));
  // Cada uno de esa lista tiene que existir como pintor, o la puerta dejaría
  // pasar un nombre que no pinta nada.
  const pintores = ((codigo.match(/var PINTORES = \{[\s\S]*?\n\};/) || [''])[0]
    .match(/^  ([a-z]+): function/gm) || []).map((x) => x.trim().split(':')[0]);
  const fantasma = reales.filter((r) => !pintores.includes(r));
  chk('todos los marcados como reales existen', fantasma.length === 0, fantasma.join(','));
}

console.log('\nNingún botón vibra y ya\n');
{
  const guion = readFileSync(new URL('../public/movil-app.js', import.meta.url), 'utf8');
  // `onclick="M.toque()"` es la firma de un botón decorativo: promete una
  // acción y solo vibra. «Llamar» era uno, y llamar es LA razón por la que
  // alguien saca el teléfono.
  chk('llamar marca de verdad', /location\.href = 'tel:' \+ t;/.test(guion));
  chk('whatsapp abre la conversación', /wa\.me\/' \+ t/.test(guion));
  // Sin número no se abre un enlace roto: se dice.
  chk('sin teléfono se avisa en vez de abrir nada',
      (guion.match(/no tiene teléfono guardado/g) || []).length >= 2);
  // Los que quedan viven detrás de la puerta del modo, así que una cuenta
  // real no los ve nunca.
  const quedan = (guion.match(/M\.toque\(\)"/g) || []).length;
  chk('no quedan botones muertos en pantallas con datos reales', quedan <= 2, String(quedan));
  // Una fila de cita sin contacto asociado no se pinta como botón.
  chk('la cita abre su contacto', /M\.abrirLead\(\\''\+esc\(String\(c\.lead\)\)/.test(guion));
  chk('y sin contacto no finge ser un botón', /: '<div class="cita">'\)/.test(guion));
  chk('«+ etiqueta» abre el catálogo de la cuenta', /M\.abrirEtiquetas\(\)/.test(guion));
}

console.log('\nEl lápiz solo donde de verdad se edita\n');
{
  const guion = readFileSync(new URL('../public/movil-app.js', import.meta.url), 'utf8');
  // Ponerlo en la fuente o en el responsable prometía algo que al tocarlo se
  // niega: un adorno que dice «puedes» y responde «no».
  // Ahora hay dos formas de tocar un campo: escribirlo (CAMPOS_FICHA) o
  // elegirlo de una lista (CAMPOS_ELEGIR, como el responsable). El lápiz sale
  // en los dos y en ninguno más.
  chk('el lápiz depende de si el campo se puede tocar',
      /var editable = !!CAMPOS_FICHA\[c\[0\]\] \|\| !!CAMPOS_ELEGIR\[c\[0\]\];/.test(guion)
      && /editable \? '<span class="lapiz">/.test(guion),
      (guion.match(/var editable = [^;]*/) || [''])[0]);
}

console.log('\nEl interruptor de una automatización no es un adorno\n');
{
  const guion = readFileSync(new URL('../public/movil-app.js', import.meta.url), 'utf8');
  // Era decorativo: `M.toque()` vibraba y ya. Y la pantalla promete por escrito
  // «aquí puedes encender y apagar las que ya tienes». Una automatización que
  // se cree apagada y siga corriendo manda correos que nadie espera.
  chk('la fila con id y estado llama a guardar, no solo a vibrar',
      /M\.alternarAuto\(/.test(guion));
  const i = guion.indexOf('function alternarAuto');
  const fn = i < 0 ? '' : guion.slice(i, guion.indexOf('\n}', i));
  chk('alternarAuto existe y guarda', /guardar\('\/api\/automations'/.test(fn), 'no llama a guardar');
  chk('manda {id, active}, que es lo que espera el servidor',
      /\{ id: a\.id, active: a\.on \}/.test(fn), fn.slice(0, 80));
  chk('y si no se guarda, el interruptor vuelve',
      /a\.on = antes;/.test(fn) && /classList\.toggle\('on'\)/.test(fn));
  // El id tiene que llegar desde el traductor o la fila no sabe a quién apagar.
  chk('la automatización traducida lleva su id',
      aAutomatizacion({ id: 'x9', name: 'N', active: true }).id === 'x9');
}

console.log('\nUn corte de un segundo no deja la pantalla rota\n');
{
  const guion = readFileSync(new URL('../public/movil-app.js', import.meta.url), 'utf8');
  // Cachear el fallo dejaba «no se pudieron traer» pegado hasta que alguien
  // diera al botón. Cerrar y volver a entrar es lo primero que hace cualquiera.
  chk('un fallo NO se guarda en la caché', /if \(datos !== null\) MODULO_CACHE\[id\] = datos;/.test(guion));
  chk('pero lo que sí llegó no se vuelve a pedir', /MODULO_CACHE\[id\];/.test(guion));
}

console.log('\nAbrir dos módulos seguidos no mezcla sus datos\n');
{
  const guion = readFileSync(new URL('../public/movil-app.js', import.meta.url), 'utf8');
  // La carga es asíncrona: si al volver se pinta sin comprobar que la hoja
  // sigue siendo la misma, las campañas acaban dentro de Propuestas.
  chk('se comprueba que la hoja siga siendo la misma antes de pintar',
      /if \(\$\('#mod-lista'\) !== lista\) return;/.test(guion));
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);

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
  chk('están los siete módulos', ids.length === 7, ids.join(','));
  for (const id of ids) {
    const { ruta, clave } = MODULOS_API[id];
    // Que la ruta exista no basta: la clave del JSON tiene que ser la misma que
    // lee app.js, o la lista viene vacía sin que nadie se entere.
    chk(id + ' usa la ruta y la clave de la web',
        app.includes(ruta) && new RegExp('\\.' + clave + '\\b').test(app), ruta + ' / ' + clave);
  }
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

console.log('\nLos módulos con pintor propio tampoco enseñan ejemplos\n');
{
  const guion = readFileSync(new URL('../public/movil-app.js', import.meta.url), 'utf8');
  const codigo = guion.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  // Esta rama se escapó al enchufar los otros: pintaba los EJEMPLOS sin mirar
  // el modo, así que a una cuenta real le enseñaba embudos, notas de NPS y
  // posiciones de SEO inventadas. Siete pantallas más diciendo lo que no es.
  const i = codigo.indexOf('if (!M && PINTORES[id])');
  const rama = i < 0 ? '' : codigo.slice(i, codigo.indexOf('return;', i));
  chk('la rama de pintor propio mira el modo antes de pintar',
      /MODO === 'real'/.test(rama), rama.slice(0, 120));
  chk('y en modo real NO llama al pintor de ejemplos',
      rama.indexOf("MODO === 'real'") < rama.indexOf('PINTORES[id]()'), 'el ejemplo se pinta antes de comprobar');
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
  chk('el lápiz depende de si el campo es editable',
      /var editable = !!CAMPOS_FICHA\[c\[0\]\];/.test(guion) && /editable \? '<span class="lapiz">/.test(guion));
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

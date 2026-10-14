// El catálogo de productos desde una hoja de Google: node pruebas/catalogo-joyas.mjs
//
// 14-10-2026, AMETT (joyería): el inventario no está al día en la web y van a
// migrar a Shopify. Se lee una hoja de Google compartida por enlace. Lo que se
// protege aquí es lo que haría quedar mal al agente sin que nada fallara:
// un precio mal leído, una hoja privada dada por buena, una pieza agotada
// ofrecida, un anillo ofrecido a quien pidió aretes, o un borrado masivo por
// una hoja a medio editar.

process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';
process.env.CRON_SECRET = 'cron';

let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + extra : '')); if (!c) mal++; };
const resp = (d, s = 200, h = {}) => new Response(typeof d === 'string' ? d : JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', ...h } });

// ── Base y hoja de mentira ──────────────────────────────────────────────────
let HOJA = { cuerpo: '', tipo: 'text/csv', status: 200 };
let PRODUCTOS = [];
let FUENTES = [];
const consultas = [];
const casa = (f, q) => {
  for (const [k, v] of q) {
    if (['select', 'order', 'limit', 'on_conflict'].includes(k)) continue;
    if (k === 'or') {
      const m = v.match(/client_id\.eq\.([^,]+),client_id\.is\.null/);
      if (m && !(f.client_id === m[1] || f.client_id == null)) return false;
      continue;
    }
    const [op, ...resto] = v.split('.'); const val = resto.join('.');
    if (op === 'eq' && String(f[k]) !== val) return false;
    if (op === 'is' && val === 'null' && f[k] != null) return false;
    if (op === 'not' && val === 'is.false' && f[k] === false) return false;
    if (op === 'lte' && !(f[k] != null && f[k] <= +val)) return false;
    if (op === 'lt' && !(f[k] < val)) return false;
    if (op === 'ilike' && !String(f[k] || '').toLowerCase().includes(val.replace(/\*/g, '').toLowerCase())) return false;
  }
  return true;
};
globalThis.fetch = async (url, init = {}) => {
  const u = String(url), m = init.method || 'GET';
  if (u.startsWith('https://docs.google.com/')) {
    return new Response(HOJA.cuerpo, { status: HOJA.status, headers: { 'content-type': HOJA.tipo } });
  }
  const q = [...new URL(u).searchParams.entries()];
  consultas.push(decodeURIComponent(u));
  if (u.includes('/client_products')) {
    if (m === 'POST') {
      for (const f of JSON.parse(init.body)) {
        const i = PRODUCTOS.findIndex(x => x.user_id === f.user_id && x.client_id === f.client_id && x.referencia === f.referencia);
        if (i >= 0) PRODUCTOS[i] = { ...PRODUCTOS[i], ...f }; else PRODUCTOS.push(f);
      }
      return new Response(null, { status: 201 });
    }
    if (m === 'DELETE') {
      const fuera = PRODUCTOS.filter(f => casa(f, q));
      PRODUCTOS = PRODUCTOS.filter(f => !casa(f, q));
      return resp(fuera);
    }
    let filas = PRODUCTOS.filter(f => casa(f, q));
    if (/order=precio\.asc/.test(u)) filas.sort((a, b) => (a.precio ?? 1e15) - (b.precio ?? 1e15));
    if ((init.headers || {}).Prefer?.includes('count=exact')) return resp([], 200, { 'content-range': `0-0/${filas.length}` });
    return resp(filas);
  }
  if (u.includes('/client_product_sources')) {
    if (m === 'PATCH') { const id = new URL(u).searchParams.get('id').slice(3); Object.assign(FUENTES.find(f => f.id === id) || {}, JSON.parse(init.body)); return new Response(null, { status: 204 }); }
    return resp(FUENTES);
  }
  return m === 'GET' ? resp([]) : new Response(null, { status: 201 });
};

const H = await import('../api/_hoja-productos.js');
const E = await import('../api/_inbox-engine.js');

// ── El enlace ───────────────────────────────────────────────────────────────
console.log('\nEl enlace que pega la gente');
ok(H.csvDeHoja('https://docs.google.com/spreadsheets/d/1AbC_x-9/edit#gid=0').csv === 'https://docs.google.com/spreadsheets/d/1AbC_x-9/export?format=csv&gid=0',
  'el de edición se lee como CSV, respetando la pestaña');
ok(H.csvDeHoja('https://docs.google.com/spreadsheets/d/1AbC/edit?usp=sharing').csv === 'https://docs.google.com/spreadsheets/d/1AbC/export?format=csv',
  'el de «compartir» también');
ok(H.csvDeHoja('https://docs.google.com/spreadsheets/d/e/2PACX-1v/pubhtml').csv.startsWith('https://docs.google.com/spreadsheets/d/e/2PACX-1v/pub?output=csv'),
  'y el de «Publicar en la web»');
ok(!!H.csvDeHoja('https://amett.co/catalogo').error, 'un enlace que no es de Google Sheets se rechaza con un mensaje');

// ── Leer la hoja ────────────────────────────────────────────────────────────
console.log('\nLeer la hoja');
const CSV = '﻿Referencia,Nombre,Tipo de joya,Colección,Material,Color del oro,Gemas,Talla o medida,Precio,Disponible,Unidades,Foto,Enlace,Descripción\n' +
  'AN-001,Solitario Aura,Anillos,Novias,Oro 18k,Amarillo,"Diamante natural 0,30 ct",7,"$ 4.850.000",Sí,1,https://drive.google.com/file/d/1FoToId/view?usp=sharing,,"Engaste de 4 garras, ideal para compromiso"\n' +
  'AR-010,Topos esmeralda,Aretes,Autor,Oro 18k,Blanco,Esmeralda colombiana,,"1,980,000",,,,,\n' +
  'DJ-003,Dije inicial,Dijes,,Oro 18k,Rosado,,,"650000",No,0,,,\n' +
  'AN-002,Argolla clásica,Anillos,,Oro 18k,Blanco,,8,3200000,Sí,0,,,\n' +
  ',Fila sin referencia,Aretes,,,,,,100000,Sí,,,,\n' +
  'AR-010,Topos esmeralda (corregido),Aretes,Autor,Oro 18k,Blanco,Esmeralda colombiana,,"2.100.000",Sí,2,,,\n';
HOJA = { cuerpo: CSV, tipo: 'text/csv; charset=utf-8', status: 200 };
const leida = await H.leerHoja('https://docs.google.com/x');
const ref = (r) => leida.filas.find(f => f.referencia === r);
ok(ref('AN-001')?.precio === 4850000, '«$ 4.850.000» son 4.850.000', ref('AN-001')?.precio);
ok(ref('AR-010')?.precio === 2100000 && ref('AR-010')?.nombre.includes('corregido'), 'una referencia repetida: gana la última fila', JSON.stringify(ref('AR-010')));
ok(leida.avisos.repetidas === 1 && leida.avisos.sin_referencia === 1, 'y se cuentan la repetida y la fila sin referencia', JSON.stringify(leida.avisos));
ok(ref('AN-001')?.gemas === 'Diamante natural 0,30 ct', 'una coma dentro de comillas no parte la celda');
ok(ref('AN-001')?.fotos?.[0] === 'https://lh3.googleusercontent.com/d/1FoToId', 'un enlace de Drive se convierte en la dirección de la imagen', ref('AN-001')?.fotos?.[0]);
ok(ref('DJ-003')?.disponible === false, '«No» es agotado');
ok(ref('AN-002')?.disponible === false, '«Sí» con 0 unidades es agotado: mandan las unidades');
ok(ref('AR-010')?.disponible === true && ref('AR-010')?.unidades === 2, 'las unidades se guardan');
ok(ref('AN-001')?.tipo === 'Anillos' && ref('AN-001')?.color_oro === 'Amarillo' && ref('AN-001')?.material === 'Oro 18k',
  '«Color del oro» y «Material» van cada uno a su sitio', JSON.stringify(ref('AN-001')));

HOJA = { cuerpo: '<!doctype html><title>Iniciar sesión</title>', tipo: 'text/html; charset=utf-8', status: 200 };
const privada = await H.leerHoja('https://docs.google.com/x');
ok(privada.privada && /Cualquier persona con el enlace/.test(privada.error), 'una hoja privada (Google responde 200 con su login) se rechaza y se dice cómo compartirla', privada.error);
HOJA = { cuerpo: 'Nombre,Precio\nAnillo,100000\n', tipo: 'text/csv', status: 200 };
ok(/Referencia/.test((await H.leerHoja('https://docs.google.com/x')).error || ''), 'sin columna «Referencia» no se carga nada y se dice por qué');
HOJA = { cuerpo: 'Referencia,Precio\nEJEMPLO-AN-001,4850000\nAN-7,900000\n', tipo: 'text/csv', status: 200 };
const conEjemplo = await H.leerHoja('https://docs.google.com/x');
ok(conEjemplo.filas.length === 1 && conEjemplo.filas[0].referencia === 'AN-7' && conEjemplo.avisos.ejemplos === 1,
  'las filas de ejemplo de la plantilla no se cargan nunca (y se cuentan)', JSON.stringify(conEjemplo));
HOJA = { cuerpo: 'Referencia,Precio\nEJEMPLO-AN-001,4850000\n', tipo: 'text/csv', status: 200 };
ok(/filas de ejemplo/.test((await H.leerHoja('https://docs.google.com/x')).error || ''), 'una plantilla sin llenar se rechaza diciendo por qué');

// ── Sincronizar ─────────────────────────────────────────────────────────────
console.log('\nSincronizar: la hoja manda');
FUENTES = [{ id: 'h1', user_id: 'u1', client_id: null, csv_url: 'https://docs.google.com/x', activo: true }];
PRODUCTOS = [{ user_id: 'u1', client_id: null, referencia: 'VIEJA-1', precio: 1, visto_en: '2020-01-01T00:00:00Z' },
  { user_id: 'otra', client_id: null, referencia: 'AJENA', precio: 1, visto_en: '2020-01-01T00:00:00Z' }];
HOJA = { cuerpo: CSV, tipo: 'text/csv', status: 200 };
const s1 = await H.sincronizarHoja(FUENTES[0]);
ok(s1.ok && s1.guardadas === 4, 'se guardan las cuatro piezas con referencia', JSON.stringify(s1));
ok(!PRODUCTOS.some(p => p.referencia === 'VIEJA-1'), 'la que ya no está en la hoja se quita (en una joyería, es la que se vendió)');
ok(PRODUCTOS.some(p => p.referencia === 'AJENA'), 'y lo de otra cuenta no se toca');
ok(FUENTES[0].ultimo_estado === 'ok' && FUENTES[0].filas === 4, 'la fuente queda anotada como buena');

// Una hoja a medio editar no deja al agente sin catálogo.
for (let i = 0; i < 10; i++) PRODUCTOS.push({ user_id: 'u1', client_id: null, referencia: 'EXTRA-' + i, precio: 100000, visto_en: '2020-01-01T00:00:00Z' });
HOJA = { cuerpo: 'Referencia,Precio\nAN-001,4850000\n', tipo: 'text/csv', status: 200 };
const antes = PRODUCTOS.filter(p => p.user_id === 'u1').length;
const s2 = await H.sincronizarHoja(FUENTES[0]);
ok(s2.freno && PRODUCTOS.filter(p => p.user_id === 'u1').length === antes, 'si de golpe desaparecen dos tercios, no se borra nada', JSON.stringify(s2));
ok(FUENTES[0].ultimo_estado === 'error' && /Sincronizar ahora/.test(FUENTES[0].ultimo_error), 'y queda a la vista, diciendo cómo confirmarlo');
const s3 = await H.sincronizarHoja(FUENTES[0], { forzar: true });
ok(s3.ok && PRODUCTOS.filter(p => p.user_id === 'u1').length === 1, 'con «Sincronizar ahora» (forzar) sí se aplica', JSON.stringify(s3));

HOJA = { cuerpo: '<html>login</html>', tipo: 'text/html', status: 200 };
const s4 = await H.sincronizarHoja(FUENTES[0], { forzar: true });
ok(s4.error && PRODUCTOS.filter(p => p.user_id === 'u1').length === 1, 'si la hoja deja de ser pública, el catálogo se queda como estaba');

// ── Lo que lee el agente ────────────────────────────────────────────────────
console.log('\nLo que pide la persona, leído de sus palabras');
const TIPOS = ['Anillos', 'Aretes', 'Dijes', 'Anillo de compromiso', 'Collares'];
ok(E.tipoDeJoyaEnTexto('Hola, busco un anillo para mi novia', TIPOS) === 'Anillos', '«un anillo» encuentra «Anillos»');
ok(E.tipoDeJoyaEnTexto('quiero ver aretes', TIPOS) === 'Aretes' && E.tipoDeJoyaEnTexto('un arete', TIPOS) === 'Aretes', 'aretes y arete');
ok(E.tipoDeJoyaEnTexto('un collar sencillo', TIPOS) === 'Collares', '«collar» encuentra «Collares»');
ok(E.tipoDeJoyaEnTexto('un dije, no, mejor unos aretes', TIPOS) === 'Aretes', 'si se corrige, gana lo último');
ok(E.tipoDeJoyaEnTexto('busco anillo de compromiso', TIPOS) === 'Anillo de compromiso', 'y el más largo cuando empiezan igual');
ok(E.colorDeOroEnTexto('lo quiero en oro rosa') === 'rosado' && E.colorDeOroEnTexto('un diamante blanco') === null,
  '«oro rosa» es rosado; «diamante blanco» no es un color de oro');
ok(E.gemaEnTexto('algo con esmeraldas') === 'esmeralda' && E.gemaEnTexto('con un rubí') === 'rubi', 'las gemas, en plural y con tilde');

console.log('\nLo que se le ofrece');
PRODUCTOS = [
  { user_id: 'u1', client_id: null, referencia: 'AN-001', nombre: 'Solitario Aura', tipo: 'Anillos', material: 'Oro 18k', color_oro: 'Amarillo', gemas: 'Diamante natural', precio: 4850000, disponible: true, fotos: ['https://x/f.jpg'] },
  { user_id: 'u1', client_id: null, referencia: 'AN-002', nombre: 'Argolla clásica', tipo: 'Anillos', material: 'Oro 18k', color_oro: 'Blanco', precio: 3200000, disponible: false },
  { user_id: 'u1', client_id: null, referencia: 'AN-003', nombre: 'Anillo esmeralda', tipo: 'Anillos', material: 'Oro 18k', color_oro: 'Blanco', gemas: 'Esmeralda', precio: 7400000, disponible: null },
  { user_id: 'u1', client_id: null, referencia: 'AR-010', nombre: 'Topos', tipo: 'Aretes', material: 'Oro 18k', color_oro: 'Blanco', gemas: 'Esmeralda', precio: 2100000, disponible: true },
];
const anillos = await E.productosParaPrompt('u1', null, { tipo: 'Anillos' });
ok(anillos.lineas.length === 2 && !anillos.lineas.some(l => l.startsWith('AN-002')), 'lo agotado no se ofrece', anillos.lineas.join(' | '));
ok(anillos.lineas.some(l => l.startsWith('AN-003') && l.includes('disponibilidad por confirmar')), 'lo que la hoja no dice, va «por confirmar», no como disponible');
ok(anillos.lineas.some(l => l.includes('$4.850.000') && l.includes('con fotos')), 'el precio literal y si tiene fotos');
const caros = await E.productosParaPrompt('u1', null, { tipo: 'Anillos', presupuesto: 1000000 });
ok(caros.sinPresupuesto && caros.lineas.length === 2 && caros.lineas.every(l => l.includes('AN-')), 'sin nada en su presupuesto, se ofrecen anillos más caros, avisándolo — nunca aretes', caros.lineas.join(' | '));
const rosa = await E.productosParaPrompt('u1', null, { tipo: 'Aretes', color: 'rosado' });
ok(rosa.sinDetalle && rosa.lineas.length === 1 && rosa.lineas[0].startsWith('AR-010'), 'sin aretes en oro rosado, los de otro color, avisándolo');
const nada = await E.productosParaPrompt('u1', null, { tipo: 'Dijes' });
ok(nada.lineas.length === 0, 'sin dijes, la lista sale vacía (y no se rellena con otra cosa)');

console.log('\nEl prompt');
const AG = { name: 'Stefania', persona: 'Asesora de AMETT.', business_ctx: 'Joyería en Barranquilla.', faqs: [], tone: 'informal' };
const p1 = E.buildSystemPrompt(AG, {}, null, anillos, 'whatsapp');
ok(/PIEZAS DEL CATÁLOGO VIGENTE QUE ENCAJAN \(2\)/.test(p1) && p1.includes('AN-001'), 'las piezas le llegan al agente');
ok(!/LO QUE HAY DISPONIBLE AHORA MISMO/.test(p1) && !/el barrio, las habitaciones/.test(p1), 'sin las reglas de inmuebles (barrio, habitaciones)');
ok(/\[FOTOS: referencia\]/.test(p1), 'y sabe cómo pedir las fotos de una pieza');
const p2 = E.buildSystemPrompt(AG, {}, null, caros, 'whatsapp');
ok(/cuestan MÁS/.test(p2), 'si se pasó del presupuesto, se le dice');
const p3 = E.buildSystemPrompt(AG, {}, null, nada, 'whatsapp');
ok(/NO TIENES NINGUNA PIEZA QUE ENCAJE/.test(p3) && !/Ni un barrio, ni un precio, ni una administración/.test(p3), 'sin piezas, el aviso es el de joyas y no el de inmuebles');
const corte = E.partesDelPrompt(AG, {}, null, anillos, 'whatsapp');
ok(!corte.estable.includes('AN-001') && corte.variable.includes('AN-001'), 'el catálogo va en la parte variable: no rompe la caché del prompt');

console.log('\nQué catálogo toca');
consultas.length = 0;
const cat = await E.catalogoParaPrompt('u1', 'pro_main', {}, [{ role: 'user', content: 'tienen aretes con esmeralda?' }]);
ok(cat.clase === 'productos' && cat.pistas.tipo === 'Aretes' && cat.pistas.gema === 'esmeralda' && cat.lineas[0]?.startsWith('AR-010'),
  'una cuenta con productos busca joyas, con lo que dijo la persona', JSON.stringify(cat));
ok(consultas.some(c => c.includes('or=(client_id.eq.pro_main,client_id.is.null)')),
  'y el catálogo de la cuenta vale también cuando el canal ya apunta al perfil del negocio');
const inm = await E.catalogoParaPrompt('sin-productos', 'c1', {}, []);
ok(inm.clase !== 'productos', 'una cuenta sin productos sigue con el catálogo de inmuebles de siempre');
const fotos = await E.fotosPedidas('Claro [FOTOS: AN-001]', 'u1', null);
ok(fotos[0] === 'https://x/f.jpg', 'las fotos de una pieza se encuentran por su referencia');
ok((await E.fotosPedidas('[FOTOS: AN-999]', 'u1', null)).length === 0, 'una referencia inventada no trae fotos');

console.log('\nEl cron');
FUENTES = [{ id: 'h1', user_id: 'u1', client_id: null, csv_url: 'https://docs.google.com/x', activo: true }];
HOJA = { cuerpo: CSV, tipo: 'text/csv', status: 200 };
const cron = (await import('../api/cron-catalogo.js')).default;
const rc = await cron(new Request('https://x/api/cron-catalogo', { headers: { authorization: 'Bearer cron' } }));
const dc = await rc.json();
ok(dc.hojas === 1 && dc.resumen.some(r => r.hoja && r.guardadas === 4), 'el cron de cada media hora también lee las hojas', JSON.stringify(dc));

console.log(mal ? `\n${mal} fallo(s)` : '\nTodo en orden');
process.exit(mal ? 1 : 0);

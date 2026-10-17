// pruebas/agente-sin-respaldo.mjs
//
// «Sí, tenemos chaquetas de jean» sin tenerlas (17-10-2026). Medido con Claude
// real, el agente de una cuenta SIN catálogo afirmaba tener lo que le
// preguntaran 6 de 6 veces y se inventaba el surtido. Se protege:
//
//   1. El guardián marca lo que se afirma tener y no está en lo que el agente
//      sabe; lo que dijo el contacto no cuenta como respaldo.
//   2. No marca lo legítimo: negaciones, condicionales, asesores, envíos que
//      sí están en el contexto, complementos («incluyendo Cali»), coletillas.
//   3. La cuenta sin catálogo recibe su propio bloque en el prompt (no el de
//      inmuebles vacío).
//   4. El motor lo aplica solo donde no hay inmuebles, con la misma reescritura
//      que un precio inventado.
//
// Los casos salen de respuestas REALES de Haiku en el ensayo del 17-10-2026
// (72 respuestas: 4 marcadas, las 4 inventos o casi; 0 escaladas).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (f) => readFileSync(join(RAIZ, f), 'utf8');
let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (c || extra === undefined ? '' : ' → ' + extra)); if (!c) mal++; };

process.env.SUPABASE_URL = 'https://sb.test';
const E = await import('../api/_inbox-engine.js');

const ROPA = 'Moda Ana es una tienda de ropa casual en Medellín. Vendemos en línea con envío a todo Colombia. Envíos de 2 a 5 días hábiles.';
const DENTAL = 'Sonrisa Plena es una clínica odontológica en Bogotá. Servicios: limpieza dental ($120.000), ortodoncia con brackets y blanqueamiento ($450.000).';
const JOYAS = 'AMETT joyería en Barranquilla. Anillos, aretes y dijes en oro.';
const marca = (ctx, r) => E.afirmaSinRespaldo(r, ctx);

console.log('\nLo que se inventa, se marca\n');
{
  ok(marca(ROPA, '¡Hola! Sí, tenemos chaquetas de jean. ¿Buscas un estilo?').join() === 'chaquetas de jean', '«Sí, tenemos chaquetas de jean» sin tenerlas');
  ok(marca(ROPA, 'Tenemos ropa casual para hombre: camisetas, sudaderas, pantalones, shorts y más.').length === 4, 'un surtido inventado, elemento por elemento');
  ok(marca(ROPA, 'Tenemos bastante en ropa casual para hombre — camisetas, pantalones, buzos, esas cosas del día a día.').join() === 'camisetas,pantalones,buzos', 'aunque la primera parte sí esté en el contexto');
  ok(marca(ROPA, 'Claro, trabajamos con varias opciones en denim.').length === 1, '«trabajamos con varias opciones en denim»');
  ok(marca(ROPA, 'Sí, tenemos presencia física, pero vendemos en línea.').length === 1, '«tenemos presencia física» (no está en el contexto)');
  ok(marca(JOYAS, 'Sí, tenemos collares en oro.').length === 1, 'en una joyería que nombra anillos, aretes y dijes, «collares» no está');
}

console.log('\nLo legítimo pasa\n');
{
  const limpias = [
    [ROPA, 'No tenemos chaquetas en este momento.', 'una negación'],
    [DENTAL, 'Para confirmar si también hacemos invisible, déjame pasarte con un asesor.', 'una condicional («si también hacemos»)'],
    [ROPA, 'Tenemos un asesor que te puede ayudar con eso.', 'un asesor'],
    [ROPA, 'Claro, hacemos envíos a todo Colombia, incluyendo Cali.', 'lo que está en el contexto, con un complemento que dijo el cliente'],
    [ROPA, 'Sí, estamos en Medellín, pero vendemos principalmente por aquí en línea.', 'adverbios'],
    [ROPA, 'Tenemos que confirmarlo con el equipo.', '«tenemos que…»'],
    [DENTAL, '¡Hola! Tenemos ortodoncia con brackets, que es muy eficaz. Para confirmar si manejamos otros tipos, déjame checarte eso con un asesor.', 'una oración relativa y una coletilla'],
    [DENTAL, 'Tenemos ortodoncia con brackets, eso te lo confirma mejor un asesor.', 'una coletilla larga tras la coma'],
    [DENTAL, 'Contamos con limpieza dental, ortodoncia con brackets y blanqueamiento.', 'los servicios del contexto'],
    [DENTAL, 'Sí, en Sonrisa Plena ofrecemos varios servicios odontológicos.', '«odontológicos» contra «odontológica» (raíz)'],
    [ROPA, 'lo que tenemos disponible ahorita, ¿qué talla buscas?', 'la pregunta que sigue no es parte de la oferta'],
    [ROPA, 'Claro, tenemos ropa para hombre y mujer.', '«hombre» y «mujer» no son productos'],
    [JOYAS, 'Tenemos anillos y aretes en oro.', 'lo que la joyería sí nombra'],
    [ROPA, 'Hacemos envíos a todo Colombia para que te llegue rápido.', '«para que…» corta la oferta'],
  ];
  for (const [ctx, r, por] of limpias) { const m = marca(ctx, r); ok(!m.length, por, JSON.stringify(m)); }
  ok(marca(ROPA, 'Sí, tenemos chaquetas de jean.').length > 0, 'lo que dijo el contacto no respalda: repetirle «chaquetas» es justo el fallo');
}

console.log('\nLo que sabe el agente\n');
{
  const sabe = E.loQueOfrece({ name: 'Valen', business_ctx: ROPA, faqs: [{ q: '¿Tienen chaquetas?', a: 'Sí, de jean y de cuero.' }] },
    { lineas: ['SHP-9 · Buzo con capota · $90.000'] }, { servicios: [{ nombre: 'Asesoría de imagen' }] });
  ok(/chaquetas/.test(sabe) && /Buzo con capota/.test(sabe) && /Asesoría de imagen/.test(sabe), 'su contexto, sus preguntas frecuentes, el catálogo y los servicios que agenda');
  ok(!marca(sabe, 'Sí, tenemos chaquetas de cuero y buzos con capota.').length, 'y con eso, afirmarlo es legítimo');
}

console.log('\nEl prompt y el motor\n');
{
  ok(/NO TIENES UN CATÁLOGO DE LO QUE SE VENDE/.test(E.BLOQUE_SIN_CATALOGO) && /NO digas que sí/.test(E.BLOQUE_SIN_CATALOGO), 'la cuenta sin catálogo recibe su bloque');
  const p = E.buildSystemPrompt({ name: 'Valen', business_ctx: ROPA, faqs: [] }, {}, null, { clase: 'ninguno', lineas: [], total: 0 }, 'whatsapp');
  ok(p.includes('NO TIENES UN CATÁLOGO') && !p.includes('Ni un barrio, ni un precio, ni una administración'), 'y ya no el de inmuebles vacío, que le hablaba de barrios a una tienda de ropa');
  const motor = leer('api/_inbox-engine.js');
  ok(/if \(!\(await tieneInmuebles\(userId, clientId\)\.catch\(\(\) => true\)\)\) return \{ clase: 'ninguno'/.test(motor), 'sin productos ni inmuebles, el catálogo es «ninguno» (si no se puede saber, se asume que hay inmuebles: como antes)');
  ok(/inventario\?\.clase === 'productos' \|\| inventario\?\.clase === 'ninguno' \? loQueOfrece/.test(motor), 'el guardián va donde no hay inmuebles (allí mandan importes y códigos)');
  ok(/const segundo = otra \? revisar\(cleanForUser\(otra\)\)/.test(motor), 'y la reescritura se revisa igual que la primera');
}

console.log(mal ? `\n${mal} fallo(s)\n` : '\nTodo en orden\n');
process.exit(mal ? 1 : 0);

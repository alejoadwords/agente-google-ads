// pruebas/tienda-agente.mjs
//
// El agente IA sabe qué compró quien le escribe (17-10-2026). Se protege:
//
//   1. Las compras salen SOLO de las oportunidades de la persona de la
//      conversación (su lead y las enlazadas), nunca de un teléfono suelto.
//   2. Sin tienda conectada no se gasta ni una consulta más por mensaje.
//   3. El bloque del prompt dice el estado de cada pedido y prohíbe inventar
//      entregas, guías o datos de otras personas.
//   4. Llega de verdad al prompt del agente.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (f) => readFileSync(join(RAIZ, f), 'utf8');
let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (c || extra === undefined ? '' : ' → ' + extra)); if (!c) mal++; };

process.env.SUPABASE_URL = 'https://sb.test';
process.env.SUPABASE_SERVICE_KEY = 'k';
const TA = await import('../api/_tienda-agente.js');
const AHORA = Date.parse('2026-10-17T15:00:00Z');

function base({ tiendas = [{ id: 'T1', nombre: 'Moda Ana', moneda: 'COP' }], pedidos = [], carritos = [] } = {}) {
  const pedidas = [];
  const consultar = async (ruta) => {
    pedidas.push(ruta);
    if (ruta.startsWith('tiendas?')) return tiendas;
    if (ruta.startsWith('leads?id=eq.')) return ruta.includes('L2') ? [{ id: 'L2', contacto_id: 'L1' }] : [];
    if (ruta.startsWith('leads?')) return [{ id: 'L1' }, { id: 'L2' }];
    if (ruta.includes('tipo=eq.pedido')) return pedidos;
    if (ruta.includes('tipo=eq.carrito')) return carritos;
    throw new Error('ruta ' + ruta);
  };
  return { consultar, pedidas };
}

console.log('\nDe quién son las compras\n');
{
  const b = base({ pedidos: [{ numero: '#1023', estado: 'enviado', total: 120000, moneda: 'COP', productos: [{ nombre: 'Camiseta', cantidad: 2 }], pagado_at: '2026-09-12T15:00:00Z', enlace: 'https://t/estado' }] });
  const c = await TA.comprasDelContacto('u1', 'L2', { ahora: AHORA, consultar: b.consultar });
  ok(c && c.pedidos.length === 1 && c.tienda === 'Moda Ana', 'las compras de la persona de la conversación');
  const consulta = b.pedidas.find(r => r.includes('tipo=eq.pedido')) || '';
  ok(/lead_id=in\.\(L1,L2\)/.test(consulta), 'de su lead y de los enlazados a él (su grupo)', consulta);
  ok(!b.pedidas.some(r => /email=|telefono=|phone=/.test(r)), 'nunca buscando un correo o un teléfono suelto');
  ok(b.pedidas.some(r => /leads\?id=eq\.L2&user_id=eq\.u1/.test(r)), 'y el lead tiene que ser de esta cuenta');
}
{
  const b = base({ tiendas: [] });
  ok(await TA.comprasDelContacto('u-sin', 'L2', { ahora: AHORA, consultar: b.consultar }) === null, 'sin tienda conectada no hay bloque');
  const antes = b.pedidas.length;
  await TA.comprasDelContacto('u-sin', 'L2', { ahora: AHORA + 60000, consultar: b.consultar });
  ok(b.pedidas.length === antes, 'y en los siguientes mensajes ni se pregunta (5 minutos)');
}
{
  const b = base();
  ok(await TA.comprasDelContacto('u1', 'L2', { ahora: AHORA, consultar: b.consultar }) === null, 'si la persona nunca compró ni dejó carrito, no hay bloque');
  ok(await TA.comprasDelContacto('u1', 'OTRO', { ahora: AHORA, consultar: b.consultar }) === null, 'un lead que no es de la cuenta no da nada');
}

console.log('\nEl bloque del prompt\n');
{
  const c = {
    tienda: 'Moda Ana', moneda: 'COP',
    pedidos: [
      { numero: '#1024', estado: 'pagado', total: 50000, moneda: 'COP', productos: [{ nombre: 'Gorra', cantidad: 1 }], pagado_at: '2026-10-16T15:00:00Z' },
      { numero: '#1023', estado: 'enviado', total: 120000, moneda: 'COP', productos: [{ nombre: 'Camiseta', cantidad: 2 }], pagado_at: '2026-09-12T15:00:00Z', enlace: 'https://t/estado' },
    ],
    carrito: { total: 80000, moneda: 'COP', productos: [{ nombre: 'Taza', cantidad: 1 }], creado_at: '2026-10-17T10:00:00Z', enlace: 'https://rec/k1' },
  };
  const b = TA.bloqueCompras(c, 'America/Bogota');
  ok(/#1024 · pagado el 16 de octubre · \$50\.000 COP · pagado, en preparación · Gorra/.test(b), 'cada pedido con fecha, total, estado y productos', b.split('\n')[1]);
  ok(/#1023 .* enviado \(no sé qué día salió\) · 2 × Camiseta · seguimiento: https:\/\/t\/estado/.test(b), 'con su enlace de seguimiento si lo hay, y sin inventar el día de envío');
  ok(/es la de PAGO, no la de envío/.test(b), 'la fecha se dice de pago, no de envío (el modelo las confundía)');
  ok(/enviado el 1 de octubre/.test(TA.bloqueCompras({ tienda: 'X', pedidos: [{ numero: '#1', estado: 'enviado', total: 1, pagado_at: '2026-09-30T15:00:00Z', enviado_at: '2026-10-01T15:00:00Z' }], carrito: null })), 'si se sabe el día de envío, se dice');
  ok(/NO inventes fechas de entrega, transportadora ni número de guía/.test(b) && /\[ESCALAR\]/.test(b), 'no inventa entregas ni guías: lo pasa a un asesor');
  ok(/nunca menciones compras de otras personas/.test(b), 'ni habla de compras ajenas');
  ok(/alguien que vuelve a comprar/.test(b), 'con dos compras pagadas, es alguien que vuelve');
  ok(/TIENE UN CARRITO SIN TERMINAR .* Taza por \$80\.000 COP/.test(b) && /https:\/\/rec\/k1/.test(b), 'y le ofrece terminar su carrito con el enlace');
  ok(/No se lo menciones de entrada/.test(b), 'pero no de entrada si escribe por otra cosa');
  ok(TA.bloqueCompras(null) === '' && TA.bloqueCompras({ pedidos: [], carrito: null }) === '', 'sin compras, nada');
}

console.log('\nEl agente lo recibe\n');
{
  const E = await import('../api/_inbox-engine.js');
  const agente = { name: 'Aura', business_ctx: 'Tienda de ropa', faqs: [] };
  const conCompras = E.buildSystemPrompt(agente, {}, null, null, 'whatsapp', null, null, null,
    { tienda: 'Moda Ana', moneda: 'COP', pedidos: [{ numero: '#9', estado: 'enviado', total: 1000, productos: [], pagado_at: '2026-10-01T12:00:00Z' }], carrito: null });
  ok(/ESTA PERSONA YA LE HA COMPRADO A MODA ANA/.test(conCompras), 'el prompt trae el historial de la persona');
  ok(!/YA LE HA COMPRADO/.test(E.buildSystemPrompt(agente, {}, null, null, 'whatsapp')), 'y sin compras, el prompt queda como siempre');
  const motor = leer('api/_inbox-engine.js');
  ok(/const compras = conv\.lead_id\s*\? await comprasDelContacto\(connection\.user_id, conv\.lead_id\)/.test(motor), 'el motor lo pide para el lead de la conversación');
  ok(/donde: 'compras del contacto'/.test(motor), 'y si falla, contesta igual y queda en el registro');
}

console.log(mal ? `\n${mal} fallo(s)\n` : '\nTodo en orden\n');
process.exit(mal ? 1 : 0);

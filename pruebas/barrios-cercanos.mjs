// Barrios cercanos por coordenadas de Domus: node pruebas/barrios-cercanos.mjs
//
// Revisión del agente de Certain (14-10-2026): «barrios cercanos» y el agente
// no sabía cuáles eran, así que lo pasaba a un asesor con inventario a dos
// cuadras. Las coordenadas solo miden distancia: nunca se le dan al contacto.

import { readFileSync } from 'fs';
import { distanciaKm, centroDelBarrio, cercanosAlBarrio, pideCercanos, RADIO_CERCANOS_KM } from '../api/_inbox-engine.js';
import { filaDeDomus } from '../api/_catalogo.js';

let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); if (!c) mal++; };

console.log('\nDistancias');
// El Prado y Alto Prado (Barranquilla), a ~1 km; Bocagrande (Cartagena), a ~100 km.
const elPrado = { lat: 10.9990, lng: -74.8050 }, altoPrado = { lat: 11.0060, lng: -74.8100 }, bocagrande = { lat: 10.3990, lng: -75.5560 };
ok(Math.abs(distanciaKm(elPrado, altoPrado) - 0.95) < 0.2, 'El Prado → Alto Prado ≈ 1 km', distanciaKm(elPrado, altoPrado));
ok(distanciaKm(elPrado, bocagrande) > 90, 'Barranquilla → Cartagena, lejos');
ok(distanciaKm(elPrado, elPrado) === 0, 'mismo punto, cero');

console.log('\nEl centro del barrio pedido');
ok(JSON.stringify(centroDelBarrio([{ lat: 10, lng: -74 }, { lat: 12, lng: -76 }])) === JSON.stringify({ lat: 11, lng: -75 }), 'promedio de sus inmuebles');
ok(centroDelBarrio([{ lat: null, lng: null }]) === null && centroDelBarrio([]) === null, 'sin coordenadas, sin centro (no se inventa)');

console.log('\nQué entra como cercano');
const cands = [
  { codigo: 'A', barrio: 'Alto Prado', lat: altoPrado.lat, lng: altoPrado.lng },
  { codigo: 'B', barrio: 'El Prado', lat: 10.9995, lng: -74.8052 },
  { codigo: 'C', barrio: 'Bocagrande', lat: bocagrande.lat, lng: bocagrande.lng },
  { codigo: 'D', barrio: 'Bellavista', lat: 11.0010, lng: -74.8000 },
  { codigo: 'E', barrio: 'Sin dato', lat: null, lng: null },
];
const c = cercanosAlBarrio(cands, elPrado, 'El Prado');
ok(c.map(x => x.codigo).join(',') === 'D,A', 'solo los de otros barrios a menos de ' + RADIO_CERCANOS_KM + ' km, del más cercano al más lejano', c.map(x => [x.codigo, x._km.toFixed(2)]));
ok(!c.some(x => x.codigo === 'B'), 'los del mismo barrio no (ya están en la lista principal)');
ok(!c.some(x => x.codigo === 'C'), 'otra ciudad no');
ok(!c.some(x => x.codigo === 'E'), 'sin coordenadas no');
ok(cercanosAlBarrio(cands, elPrado, 'el prado').every(x => x.barrio !== 'El Prado'), 'el barrio se compara sin mayúsculas ni tildes');
ok(cercanosAlBarrio(cands, null, 'El Prado').length === 0, 'sin centro, nada');
ok(cercanosAlBarrio(Array.from({ length: 20 }, (_, i) => ({ codigo: 'x' + i, barrio: 'Bellavista', lat: 11.0, lng: -74.80 })), elPrado, 'El Prado').length === 3, 'como mucho tres (lo que cabe en un mensaje)');

console.log('\n¿Pide opciones cerca?');
for (const t of ['barrios cercanos', '¿tienes algo cerca?', 'por los alrededores', 'en barrios vecinos', 'algo por ahí']) ok(pideCercanos([t]), '«' + t + '»');
for (const t of ['no tienes más opciones', 'busco un local en el prado', '']) ok(!pideCercanos([t]), 'no: «' + t + '»');

console.log('\nDomus: se guardan las coordenadas, nunca la dirección');
{
  const f = filaDeDomus({ codpro: 1, biz: 'ARRIENDO', city: 'Barranquilla', neighborhood: 'El Prado', latitude: '11.0173', longitude: '-74.8239', city_zone: 'Zona Norte Centro Histórico', address: 'CALLE 98 # 45 - 11' }, 'u', 'c', null, null);
  ok(f.lat === 11.0173 && f.lng === -74.8239, 'lat y lng como números');
  ok(f.zona === 'Zona Norte Centro Histórico', 'la zona de Domus');
  ok(!('address' in f) && !JSON.stringify(f).includes('CALLE 98'), 'la dirección exacta NO se guarda');
  const g = filaDeDomus({ codpro: 2, latitude: '0', longitude: '', city_zone: 'SIN ZONA' }, 'u', 'c', null, null);
  ok(g.lat === null && g.lng === null && g.zona === null, 'Domus en 0 / vacío / «SIN ZONA» → null');
}

console.log('\nEl prompt');
const eng = readFileSync(new URL('../api/_inbox-engine.js', import.meta.url), 'utf8');
ok(/CERCA de .*\(otro barrio\)/.test(eng), 'las cercanas van marcadas en la lista');
ok(/No des distancias ni direcciones exactas/.test(eng), 'y el agente no da distancias ni direcciones');
ok(/NO pases la conversación a un asesor para buscar en barrios cercanos/.test(eng), 'con cercanas a mano, no se pasa al asesor');
ok(eng.indexOf('let cercanas = []') < eng.indexOf('ampliado = true;'), 'se busca cerca ANTES de ampliar a toda la ciudad');

console.log(mal ? `\n${mal} fallo(s)` : '\nTodo en verde');
process.exit(mal ? 1 : 0);

// pruebas/ruta.mjs
//
// La ruta de arranque (15-10-2026): 7 días de pasos que se marcan SOLOS según
// lo que de verdad hay en la cuenta. Se protege:
//
//   1. Que cada paso se detecte por su prueba más directa (un canal de prueba
//      no cuenta, una automatización apagada tampoco).
//   2. Que el porcentaje cuente las tres entradas (WhatsApp, redes, web) como
//      UNA, y no castigue lo opcional según el negocio.
//   3. Que el premio de 7 días se dé una sola vez, solo en prueba, solo con los
//      esenciales, y nunca desde una sesión de soporte.
//   4. Que el correo del día hable del siguiente paso, nunca de lo hecho, y que
//      el cron mande uno por día y nada a quien ocultó la ruta.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (f) => readFileSync(join(RAIZ, f), 'utf8');
let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (c || extra === undefined ? '' : ' → ' + extra)); if (!c) mal++; };

const R = await import('../api/_ruta.js');
const DIA = 86400000;

console.log('\nCada paso se detecta por su prueba más directa\n');
{
  const vacia = R.detectar({});
  ok(Object.values(vacia).every(v => v === false), 'una cuenta vacía no tiene nada hecho');
  const h = R.detectar({
    etapas: [{ label: 'Cliente recibido' }], pipelines: [{ name: 'Principal' }], leads: 3,
    canales: [{ channel: 'whatsapp', is_active: true, external_id: 'sim_123', agent_id: 'a' },
              { channel: 'instagram', is_active: true, external_id: '1789', agent_id: null }],
    automatizaciones: [{ active: false, trigger: { type: 'lead_created' } }, { active: true, trigger: { type: 'lead_inactive', days: 3 } }],
    agentes: [{ business_ctx: 'corto', faqs: [] }], catalogo: 0,
  });
  ok(h.proceso, 'una etapa con nombre propio es un proceso ajustado');
  ok(!h.whatsapp && !h.agente_canal, 'un WhatsApp de prueba (sim_) no cuenta, ni su agente');
  ok(h.redes, 'Instagram conectado de verdad sí');
  ok(!h.bienvenida && h.rescate, 'una automatización apagada no cuenta; una encendida sí');
  ok(h.agente && !h.entrenar, 'un agente sin contexto ni preguntas no está entrenado');
  ok(R.detectar({ agentes: [{ business_ctx: '', faqs: [] }], catalogo: 12 }).entrenar, 'con catálogo, sí');
  ok(!R.detectar({ pipelines: [{ name: 'Principal' }], etapas: R.ETAPAS_POR_DEFECTO.map(label => ({ label })) }).proceso,
     'las etapas por defecto no cuentan como proceso ajustado');
}

console.log('\nEl porcentaje es justo\n');
{
  const opc = R.opcionales('Restaurantes / Food', 'Solo yo');
  ok(opc.has('equipo') && opc.has('reparto'), 'quien trabaja solo no tiene que invitar equipo');
  ok(opc.has('propuesta'), 'un restaurante no tiene que mandar propuestas');
  const hechos = Object.fromEntries(R.PASOS.map(p => [p.id, false]));
  hechos.web = true;
  const r = R.armarRuta({ pasos: R.PASOS, hechos, hitos: {}, opc: R.opcionales('', ''), inicio: Date.now() - 2.5 * DIA });
  ok(r.dia_actual === 3, 'el día sale de cuándo terminó el alta', r.dia_actual);
  const conTres = R.armarRuta({ pasos: R.PASOS, hechos: { ...hechos, whatsapp: true, redes: true }, hitos: {}, opc: R.opcionales('', ''), inicio: Date.now() });
  ok(r.progreso.hechos === conTres.progreso.hechos, 'las tres entradas cuentan como una: con una basta');
  ok(r.siguiente === 'proceso', 'el siguiente es el primer pendiente del día en curso o anterior', r.siguiente);
  ok(!R.esencialesCumplidos(hechos), 'sin los esenciales no hay premio');
  const todo = Object.fromEntries(R.PASOS.map(p => [p.id, !!p.esencial]));
  ok(!R.esencialesCumplidos(todo), 'los esenciales necesitan además una entrada de leads');
  ok(R.esencialesCumplidos({ ...todo, whatsapp: true }), 'con una entrada, sí');
}

console.log('\nEl premio y el soporte\n');
{
  const api = leer('api/ruta.js');
  ok(/if \(cumplidos && enPrueba && !estado\?\.premio_at && !deSoporte\)/.test(api), 'premio: esenciales, en prueba, una sola vez, nunca desde soporte');
  ok(/trial_until: hasta, ruta_premio: ahoraIso/.test(api) && /PREMIO_DIAS \* DIA/.test(api), 'suma 7 días a la fecha de fin de la prueba');
  ok(/if \(Object\.keys\(cambios\)\.length && !deSoporte\) await guardarEstado/.test(api), 'desde soporte no se anota nada');
  ok(/const completa = !quien\.esMiembro \|\| quien\.perfil === 'admin';/.test(api), 'dueño y administradores ven la ruta completa; un asesor, la suya');
  ok(/creada >= RUTA_DESDE/.test(api), 'solo para cuentas de la era del alta guiada');
}

console.log('\nEl correo del día y el cron\n');
{
  process.env.SUPABASE_URL = 'https://sb.test';
  const C = await import('../api/cron-ruta.js');
  const hechos = Object.fromEntries(R.PASOS.map(p => [p.id, false]));
  Object.assign(hechos, { proceso: true, contactos: true, web: true });
  const ruta = R.armarRuta({ pasos: R.PASOS, hechos, hitos: {}, opc: R.opcionales('', ''), inicio: Date.now() - 3.2 * DIA });
  const { asunto, html } = C.correoDelDia({ nombre: 'Camila', negocio: 'VIVA', ruta, premio: '22 de octubre' });
  ok(/^Día 4 de tu arranque: /.test(asunto), 'el asunto dice el día y el paso', asunto);
  ok(!/Ajusta tu proceso|Trae tus contactos|Recibe los leads de tu web/.test(html), 'no habla de lo que ya hizo');
  ok(/7 días más de Pro/.test(html), 'recuerda el premio mientras se puede ganar');
  const cron = leer('api/cron-ruta.js');
  ok(/if \(estado\.oculta_at\) continue;/.test(cron), 'a quien ocultó la ruta no le escribe');
  ok(/if \(\(estado\.correos \|\| \{\}\)\[clave\]\) continue;/.test(cron), 'uno por día, como mucho');
  ok(/if \(ruta\.progreso\.hechos >= ruta\.progreso\.total\) continue;/.test(cron), 'a quien terminó, tampoco');
  ok(/ahora - ultimo > 2 \* DIA/.test(cron) && /AVISAR_A/.test(cron), 'las cuentas trabadas 2 días le llegan a Alejandro');
  ok(/'cron-ruta': 24 \* 60/.test(leer('api/_latido.js')) && /"\/api\/cron-ruta"/.test(leer('vercel.json')), 'el cron está programado y vigilado');
}

console.log('\nLa pantalla\n');
{
  const app = leer('public/app.js');
  ok(/renderPulso\(\);rutaPintar\(\);/.test(app), 'Inicio pinta la ruta junto al Pulso');
  ok(/id="ruta-section"/.test(leer('public/index.html')), 'y tiene su sitio arriba del Pulso');
  ok(/if \(!d \|\| d\.error \|\| !d\.visible\) \{ box\.style\.display = 'none'/.test(app), 'si no se puede leer, Inicio sigue igual');
  ok(/PUT', body: JSON\.stringify\(\{ id: porClave\[RUTA_CLAVES\[i\]\]\.id, label: etapas\[i\] \}\)/.test(app), 'la plantilla de proceso renombra etapas, no las borra');
  ok(Object.keys(R.PASOS.reduce((a, p) => (a[p.ir] = 1, a), {})).every(d => /case '/.test(app) && (app.includes("case '" + d + "'") || ['crm', 'fuentes', 'ajustes-equipo', 'integraciones', 'propuestas', 'analisis', 'pauta'].includes(d))),
     'cada botón tiene a dónde ir');
  ok(/case 'ruta':\s+rutaMostrar\(\)\.then\(\(\) => rutaAbrir\(\)\)/.test(app), 'el enlace del correo abre la ruta');
}

console.log(mal ? `\n${mal} fallo(s)\n` : '\nTodo en orden\n');
process.exit(mal ? 1 : 0);

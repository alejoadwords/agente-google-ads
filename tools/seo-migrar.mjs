// tools/seo-migrar.mjs — del Proyecto SEO viejo (blob en user_profiles,
// agent_key '…seo-project') a las tablas nuevas (sql/seo_proyectos.sql).
//
//   node tools/seo-migrar.mjs            muestra lo que haría
//   node tools/seo-migrar.mjs --hacer    lo hace
//
// No borra ni toca el blob: solo crea filas nuevas. Idempotente: un blob ya
// migrado (seo_proyectos.legado = user_id/agent_key) se salta.
import { execFileSync } from 'child_process';
import { desdeBlob, dominio, accionesIniciales, isoDe } from '../api/_seo.js';

const R = new URL('..', import.meta.url).pathname;
// La Management API limita las peticiones por minuto: se reintenta con espera.
function sql(q) {
  for (let intento = 1; ; intento++) {
    try { return JSON.parse(execFileSync('node', [R + 'tools/sql.mjs', q], { cwd: R, maxBuffer: 100 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).toString() || '[]'); }
    catch (e) {
      if (!/429|Too Many/.test(String(e.stderr || e.message)) || intento >= 10) throw e;
      execFileSync('sleep', [String(6 * intento)]);
    }
  }
}
const lit = (v) => v == null ? 'null' : "'" + String(v).replace(/'/g, "''") + "'";
const jsonb = (v) => lit(JSON.stringify(v ?? null)) + '::jsonb';
const HACER = process.argv.includes('--hacer');

const blobs = sql(`select user_id, agent_key, profile_data from user_profiles where agent_key like '%seo-project'`);
for (const b of blobs) {
  const legado = b.user_id + '/' + b.agent_key;
  const ya = sql(`select id from seo_proyectos where legado=${lit(legado)} limit 1`);
  const d = b.profile_data || {};
  const cliente = (b.agent_key.match(/^client_(.+)_seo-project$/) || [])[1] || '';
  const m = desdeBlob(d);
  console.log(`${ya.length ? '· ya migrado ' : '→ '}${d.domain} (${b.user_id}${cliente ? ', cliente ' + cliente : ''}): ${m.kws.length} keywords, ${m.kws.reduce((a, k) => a + k.historial.length, 0)} mediciones, ${m.preguntas.length} preguntas GEO, ${m.geo.length} respuestas, ${m.acciones.length} acciones`);
  if (ya.length || !HACER) continue;

  const inicio = (isoDe(d.createdAt) || new Date().toISOString()).slice(0, 10);
  const [p] = sql(`insert into seo_proyectos (user_id, client_id, nombre, dominio, marca, pais, competidores, inicio, legado)
    values (${lit(b.user_id)}, ${lit(cliente)}, ${lit(d.brand || dominio(d.domain))}, ${lit(dominio(d.domain))}, ${lit(d.brand || null)},
      ${lit(d.country || 'co')}, ${jsonb((d.competitors || []).map(dominio).filter(Boolean))}, ${lit(inicio)}, ${lit(legado)}) returning id`);
  for (const k of m.kws) {
    const [kw] = sql(`insert into seo_keywords (proyecto_id, kw) values (${lit(p.id)}, ${lit(k.kw)}) on conflict do nothing returning id`);
    if (!kw) continue;
    const filas = k.historial.map((h, i) => `(${lit(p.id)}, ${lit(kw.id)}, ${lit(h.fecha)}, ${h.pos == null ? 'null' : +h.pos}, ${lit(h.url)}, ${i === k.historial.length - 1 ? jsonb((k.top || []).map(t => ({ pos: t.position, titulo: t.title, url: t.link, dominio: t.domain }))) : 'null'})`);
    if (filas.length) sql(`insert into seo_posiciones (proyecto_id, keyword_id, fecha, pos, url, top) values ${filas.join(',')} on conflict (keyword_id, fecha) do nothing`);
  }
  const idPregunta = {};
  for (const q of m.preguntas) {
    const [x] = sql(`insert into seo_geo_preguntas (proyecto_id, pregunta) values (${lit(p.id)}, ${lit(q)}) returning id`);
    idPregunta[q] = x.id;
  }
  const geo = m.geo.filter(r => idPregunta[r.pregunta]).map(r => `(${lit(p.id)}, ${lit(idPregunta[r.pregunta])}, ${lit(r.periodo)}, ${lit(r.motor)}, 1, ${r.mencionada == null ? 'null' : r.mencionada}, ${r.posicion == null ? 'null' : +r.posicion}, ${jsonb(r.competidores)}, ${lit(r.fragmento)}, ${lit(r.error)})`);
  if (geo.length) sql(`insert into seo_geo_resultados (proyecto_id, pregunta_id, periodo, motor, corrida, mencionada, posicion, competidores, fragmento, error) values ${geo.join(',')} on conflict do nothing`);
  // El cronograma arranca con la configuración inicial y lo que ya tenía marcado.
  const ini = accionesIniciales(p.id, inicio);
  const acc = [...ini.map(a => ({ ...a })), ...m.acciones.map((a, i) => ({ proyecto_id: p.id, mes: a.mes, categoria: 'otro', titulo: a.titulo, estado: a.estado, orden: 100 + i }))];
  sql(`insert into seo_acciones (proyecto_id, mes, categoria, titulo, detalle, estado, orden, plantilla, visible_cliente) values ${acc.map(a =>
    `(${lit(p.id)}, ${lit(a.mes)}, ${lit(a.categoria)}, ${lit(a.titulo)}, ${lit(a.detalle || null)}, ${lit(a.estado)}, ${a.orden || 0}, ${lit(a.plantilla || null)}, true)`).join(',')}`);
  console.log('   ✓ migrado como', p.id);
}
if (!HACER) console.log('\n(ensayo: no se escribió nada; con --hacer se migra)');

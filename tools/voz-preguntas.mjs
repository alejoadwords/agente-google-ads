#!/usr/bin/env node
// tools/voz-preguntas.mjs — ¿vale la pena un enrutador gratis para la voz?
//
// Cada consulta al asistente de voz cuesta una llamada a Claude. Si buena
// parte de lo que se pregunta son diez formas repetidas, un enrutador local
// puede atenderlas sin modelo y a coste cero. La pregunta es si ese «buena
// parte» es el 60% o el 15%, y eso no se adivina: se mide.
//
//   node tools/voz-preguntas.mjs [días]      (por defecto 30)
//
// Solo lee. No toca nada.

const REF = 'qgznzzhkuwxcknmcnrzn';
const DIAS = Number(process.argv[2]) || 30;

async function servicio() {
  const { execSync } = await import('node:child_process');
  const tok = Buffer.from(
    execSync('security find-generic-password -s "Supabase CLI" -w', { encoding: 'utf8' })
      .trim().replace(/^go-keyring-base64:/, ''), 'base64').toString();
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys`, {
    headers: { Authorization: `Bearer ${tok}`, 'User-Agent': 'SupabaseCLI/2.72.7' },
  });
  if (!r.ok) throw new Error('no se pudo recuperar la clave: ' + r.status);
  return (await r.json()).find(k => k.name === 'service_role').api_key;
}

// Sin tildes, sin signos y sin las palabras que no distinguen una pregunta de
// otra. «¿Qué tengo pendiente hoy?» y «qué tengo pendiente para hoy» son la
// misma pregunta y tienen que caer en el mismo grupo.
const VACIAS = new Set(['que','cual','cuales','cuanto','cuanta','cuantos','cuantas','como','donde','quien','quienes',
  'el','la','los','las','un','una','unos','unas','de','del','al','a','en','por','para','con','y','o','me','mi','mis',
  'tengo','hay','esta','estan','es','son','se','su','sus','lo','le','te','dime','dame','muestrame','digame','ver']);

// Los nombres propios se quitan ANTES de comparar: «en qué fase está Liliana
// Blanco» y «en qué fase está Jorge Acosta» son la misma pregunta con distinto
// argumento, y un enrutador las atendería con la misma regla. Dejarlos dentro
// las contaba como formas distintas y hundía el porcentaje.
function huella(t) {
  const crudo = String(t).replace(/[¿?¡!.,;:]/g, ' ').split(/\s+/).filter(Boolean);
  const sinNombres = crudo.filter((p, i) => i === 0 || !/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}$/.test(p));
  return sinNombres.join(' ').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .split(/\s+/).filter(p => p && !VACIAS.has(p))
    .sort().join(' ');
}

// Dos preguntas se parecen si comparten la mayoría de sus palabras con peso.
function parecido(a, b) {
  const A = new Set(a.split(' ')), B = new Set(b.split(' '));
  if (!A.size || !B.size) return 0;
  let comunes = 0;
  A.forEach(p => { if (B.has(p)) comunes++; });
  return comunes / Math.max(A.size, B.size);
}

const key = await servicio();
const desde = new Date(Date.now() - DIAS * 86400000).toISOString();
const filas = await fetch(
  `https://${REF}.supabase.co/rest/v1/voz_consultas?created_at=gte.${desde}` +
  `&select=texto,herramientas,vueltas,etiqueta,respondio,ms,costo&order=created_at.desc&limit=2000`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } },
).then(r => r.json());

if (!Array.isArray(filas) || !filas.length) {
  console.log(`\nNo hay preguntas registradas en los últimos ${DIAS} días.\n`);
  process.exit(0);
}

// ── agrupar por parecido ────────────────────────────────────────────────────
const grupos = [];
for (const f of filas) {
  const h = huella(f.texto);
  if (!h) continue;
  const g = grupos.find(x => parecido(x.huella, h) >= 0.6);
  if (g) { g.n++; g.ejemplos.push(f.texto); g.herramientas.push((f.herramientas || []).join('+')); }
  else grupos.push({ huella: h, n: 1, ejemplos: [f.texto], herramientas: [(f.herramientas || []).join('+')] });
}
grupos.sort((a, b) => b.n - a.n);

const total = filas.length;
const costo = filas.reduce((s, f) => s + (Number(f.costo) || 0), 0);
const fallidas = filas.filter(f => !f.respondio).length;
const msMedio = Math.round(filas.reduce((s, f) => s + (Number(f.ms) || 0), 0) / total);

console.log(`\n${total} preguntas en ${DIAS} días · $${costo.toFixed(2)} gastados · ${msMedio} ms de media` +
            (fallidas ? ` · ${fallidas} sin respuesta` : ''));
console.log(`Media por consulta: $${(costo / total).toFixed(4)}\n`);

console.log('LO QUE MÁS SE PREGUNTA');
grupos.slice(0, 12).forEach(g => {
  const herr = [...new Set(g.herramientas)].filter(Boolean);
  console.log(`  ${String(g.n).padStart(3)}×  ${g.ejemplos[0].slice(0, 62)}`);
  console.log(`       ${herr.length === 1 ? 'siempre usa: ' + herr[0] : 'usa ' + herr.length + ' caminos distintos'}`);
});

// ── el veredicto ────────────────────────────────────────────────────────────
// Un grupo solo es enrutable si se repite Y siempre acaba en la misma
// consulta: si el modelo tomó caminos distintos para la misma frase, es que la
// frase no determina la respuesta y programarla a mano se equivocaría.
const enrutables = grupos.filter(g => g.n >= 3 && new Set(g.herramientas).size === 1);
const cubre = enrutables.reduce((s, g) => s + g.n, 0);
const pct = Math.round(cubre / total * 100);

console.log(`\nVEREDICTO`);
console.log(`  ${enrutables.length} formas repetidas y estables cubren ${cubre} de ${total} preguntas (${pct}%).`);
console.log(`  Ahorro si se enrutan gratis: $${(costo / total * cubre).toFixed(2)} de $${costo.toFixed(2)}.`);
if (pct >= 50) console.log('  → Vale la pena el híbrido.');
else if (pct >= 25) console.log('  → Está en el límite. Decide por el ahorro en plata, no por el porcentaje.');
else console.log('  → NO vale la pena: se pregunta de formas demasiado distintas. Mejor abaratar el modelo.');
console.log('');

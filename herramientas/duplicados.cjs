// const/let repetidos en el mismo ámbito. node --check NO los detecta cuando
// están en funciones distintas, pero sí rompen si comparten ámbito — y ya nos
// pasó: un 'const clientId' declarado dos veces tapó META_APP_ID.
const fs = require('fs');
const src = fs.readFileSync(process.argv[2] || 'app.js', 'utf8');
// LIMITE CONOCIDO: cuenta llaves por línea y se confunde con las que van dentro
// de plantillas o expresiones regulares, así que da falsos positivos con nombres
// muy cortos ('d', 'r') reutilizados en funciones distintas. Sirve para lo que
// se hizo: pillar el mismo nombre declarado dos veces en un ámbito de verdad.
const lineas = src.split('\n');
let nivel = 0;
const ambitos = [new Map()];
let hallazgos = 0;
lineas.forEach((l, i) => {
  const limpia = l.replace(/\/\/.*$/, '').replace(/(["'`]).*?\1/g, '""');
  const decl = limpia.match(/^\s*(?:const|let)\s+([A-Za-z_$][\w$]*)/);
  if (decl) {
    const m = ambitos[ambitos.length - 1];
    if (m.has(decl[1])) { console.log(`DUPLICADO ${decl[1]} — líneas ${m.get(decl[1])} y ${i + 1}`); hallazgos++; }
    else m.set(decl[1], i + 1);
  }
  for (const c of limpia) {
    if (c === '{') { nivel++; ambitos.push(new Map()); }
    else if (c === '}') { nivel--; if (ambitos.length > 1) ambitos.pop(); }
  }
});
if (!hallazgos) console.log('duplicados: ninguno');

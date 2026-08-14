// Funciones invocadas desde onclick/onchange/onblur… que nadie define.
// Nació de un botón que no hacía nada y no daba error en consola.
const fs = require('fs');
const js = fs.readFileSync('app.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const definidas = new Set();
for (const m of js.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) definidas.add(m[1]);
for (const m of js.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/g)) definidas.add(m[1]);
for (const m of js.matchAll(/([A-Za-z_$][\w$]*)\s*=\s*function/g)) definidas.add(m[1]);
const globales = new Set(['alert','confirm','prompt','open','print','close','event','this','fetch','Date','parseInt','parseFloat','String','Number','JSON','Math','Array','Object','setTimeout','encodeURIComponent','decodeURIComponent','isNaN']);
const llamadas = new Map();
for (const src of [js, html]) {
  for (const m of src.matchAll(/on(?:click|change|input|blur|focus|submit|keydown|keyup|mousedown)\s*=\s*(["'])([\s\S]*?)\1/g)) {
    // Sin el (?<![.\w$]) todo .remove() y .closest() salía como huérfano: son
    // métodos de un objeto, no funciones globales.
    for (const f of m[2].matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
      const n = f[1];
      if (!definidas.has(n) && !globales.has(n) && !/^(if|for|while|return|typeof|new|catch|switch|function)$/.test(n)) {
        llamadas.set(n, (llamadas.get(n) || 0) + 1);
      }
    }
  }
}
if (!llamadas.size) console.log('huerfanos: ninguno');
else for (const [n, c] of llamadas) console.log('HUERFANO', n, '×' + c);

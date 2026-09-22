// Que una cuenta suspendida quede fuera de verdad, y que nadie más se vea
// afectado si la comprobación falla.
import fs from 'fs';
for (const l of fs.readFileSync(process.argv[2]+'/.env','utf8').split('\n')) { const i=l.indexOf('='); if(i>0) process.env[l.slice(0,i)]=l.slice(i+1); }
const { estaSuspendido, quienPregunta } = await import('/Users/mac/Documents/Claude/Acuarius/api/_perfiles.js?v='+Date.now());
let mal=0; const ok=(c,m)=>{console.log((c?'  ✓ ':'  ✗ ')+m); if(!c)mal++;};

const SUSPENDIDA='user_3JeIuXbjV4PvnQFSAlZXyU8qAuY';   // la del phishing
const NORMAL='user_3HYi3uHYQyth190Tr2HXZKmHbTk';        // Certain & Pezzano

ok(await estaSuspendido(SUSPENDIDA) === true, 'la cuenta suspendida se reconoce');
ok(await estaSuspendido(NORMAL) === false, 'una cuenta normal NO');
ok(await estaSuspendido('') === false, 'sin usuario, no se suspende a nadie');

let cortada = false;
try { await quienPregunta(SUSPENDIDA); } catch (e) { cortada = !!e.suspendida; }
ok(cortada, 'quienPregunta la corta con su marca propia (no un 503 confuso)');

const q = await quienPregunta(NORMAL);
ok(q && q.userId === NORMAL, 'y la cuenta normal sigue pasando');

// el código del servidor y del navegador
const p = fs.readFileSync('/Users/mac/Documents/Claude/Acuarius/api/_perfiles.js','utf8');
ok(/catch \{ return false; \}/.test(p), 'si la lista no se puede leer NO se suspende a nadie: un tropiezo de la base no puede dejar fuera a la clientela');
const leads = fs.readFileSync('/Users/mac/Documents/Claude/Acuarius/api/leads.js','utf8');
ok(/if \(await estaSuspendido\(userId\)\)/.test(leads), '/api/leads lo comprueba a mano (no pasa por quienPregunta)');
const cuantos = (fs.readdirSync('/Users/mac/Documents/Claude/Acuarius/api')
  .filter(f=>f.endsWith('.js'))
  .filter(f=>/suspendida: true/.test(fs.readFileSync('/Users/mac/Documents/Claude/Acuarius/api/'+f,'utf8')))).length;
ok(cuantos >= 11, 'los endpoints devuelven la marca · ' + cuantos + ' ficheros');
const app = fs.readFileSync('/Users/mac/Documents/Claude/Acuarius/public/app.js','utf8');
ok(/d\.suspendida\) \{ cuentaSuspendida/.test(app), 'el navegador la detecta y enseña la pantalla');
process.exit(mal?1:0);

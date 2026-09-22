// Prueba del normalizador del servidor y de la traducción del desplegable.
import fs from 'fs';
// app.js es código de navegador: al extraer una función se arrastran sus
// constantes de módulo, y algunas leen `window`. Un armazón mínimo basta.
globalThis.window = {}; globalThis.document = { getElementById: () => null };
const src = f => fs.readFileSync('/Users/mac/Documents/Claude/Acuarius/'+f,'utf8');
function sacar(f, firma, conConstantes = true) {
  const s = src(f), i = s.indexOf(firma);
  if (i < 0) throw new Error('no encuentro ' + firma);
  let d=0, j=s.indexOf('{', i);
  for (let k=j;k<s.length;k++){ if(s[k]==='{')d++; else if(s[k]==='}'){d--; if(!d){j=k;break;}} }
  // Solo para los módulos del servidor: en app.js las constantes de módulo
  // arrastran medio navegador y la función que se prueba no necesita ninguna.
  const consts = conConstantes ? (s.match(/^const [A-Z_]+ = .*;$/gm)||[]).join('\n') : '';
  return eval('(() => { '+consts+'\n return ('+s.slice(i,j+1)+'); })()');
}
const norm = sacar('api/pipeline-stages.js','function normalizarAlEntrar(');
let mal=0; const ok=(c,m)=>{console.log((c?'  ✓ ':'  ✗ ')+m); if(!c)mal++;};

ok(norm(null) === null, 'sin configuración → null');
ok(norm({tipo:'nada'}) === null, '«nada» no se guarda como ruido, se guarda null');
ok(norm({tipo:'inventado'}) === null, 'un tipo desconocido no pasa');
const c = norm({tipo:'cita', duracion:90, titulo:'Visita al inmueble'});
ok(c.tipo==='cita' && c.duracion===90 && c.titulo==='Visita al inmueble', 'una cita válida pasa entera');
ok(norm({tipo:'cita', duracion:7}).duracion === 60, 'una duración fuera del catálogo cae a 1 h');
ok(norm({tipo:'cita'}).titulo === 'Cita', 'sin título, uno por defecto');
ok(norm({tipo:'cita', avisarChoque:false}).avisarChoque === false, 'se puede apagar el aviso de choque');
ok(norm({tipo:'cita'}).avisarChoque === true, 'y por defecto avisa');

// la traducción del desplegable del navegador
const app = src('public/app.js');
const val = sacar('public/app.js','function pipeAlEntrarValor(', false);
ok(val({al_entrar:{tipo:'cita',duracion:90}}) === 'cita:90', 'el desplegable refleja lo guardado');
ok(val({}) === '', 'y «nada» cuando no hay nada');
ok(/pipeSelAlEntrar\(s, i\)/.test(app), 'el selector está en la fila del editor');
ok(/al_entrar: s\.al_entrar \|\| null/.test(app), 'y se manda al guardar');
ok((app.match(/citaAbrir\(/g)||[]).length === 4, 'los 3 enganches + la definición · encontrados ' + (app.match(/citaAbrir\(/g)||[]).length);
const selSrc = String(sacar('public/app.js','function pipeSelAlEntrar(', false));
ok(/s\.key === 'ganado' \|\| s\.key === 'perdido'/.test(selSrc), 'ganado y perdido no ofrecen la opción: ya piden el cierre');
process.exit(mal?1:0);

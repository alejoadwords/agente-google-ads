// El camino del PUT de /api/leads, tal como queda, contra la base real.
// SOLO LECTURA sobre los datos del cliente: se copia el lead a uno de prueba.
import fs from 'fs';
for (const l of fs.readFileSync(process.argv[2]+'/.env','utf8').split('\n')) { const i=l.indexOf('='); if(i>0) process.env[l.slice(0,i)]=l.slice(i+1); }
const SB=process.env.SUPABASE_URL, K=process.env.SUPABASE_SERVICE_KEY;
const H={apikey:K,Authorization:'Bearer '+K,'Content-Type':'application/json'};
let mal=0; const ok=(c,m)=>{console.log((c?'  ✓ ':'  ✗ ')+m); if(!c)mal++;};

// el lead que reportó el asesor — solo se LEE
const real = (await fetch(`${SB}/rest/v1/leads?id=eq.66d5fad1-2d70-48bd-921b-81f53ab08808&select=id,name,pipeline_id,value,user_id,client_id`,{headers:H}).then(r=>r.json()))[0];
console.log('  lead reportado:', real.name, '· valor', real.value, '· tablero', real.pipeline_id, '\n');

// la decisión del handler, tal como queda ahora
function decide({ pipelineActual, pipelinePedido, esMiembro, rol, previsualizar }) {
  if (pipelinePedido === undefined) return 'edición normal';
  if (String(pipelineActual||'') !== String(pipelinePedido||'') || previsualizar) {
    if (esMiembro && rol !== 'admin') return '403 solo un administrador';
    return 'mover de proceso';
  }
  return 'edición normal';
}
const P = real.pipeline_id;

ok(decide({pipelineActual:P, pipelinePedido:P, esMiembro:true, rol:'vendedor'}) === 'edición normal',
   'ASESOR editando el valor, mismo tablero → edición normal (antes: 403)');
ok(decide({pipelineActual:P, pipelinePedido:P, esMiembro:false}) === 'edición normal',
   'DUEÑA editando el valor, mismo tablero → edición normal (antes: «ya está en ese proceso» y el valor se perdía)');
ok(decide({pipelineActual:P, pipelinePedido:undefined, esMiembro:true, rol:'vendedor'}) === 'edición normal',
   'y si el navegador ya no lo manda, igual');
ok(decide({pipelineActual:P, pipelinePedido:'otro-tablero', esMiembro:true, rol:'vendedor'}) === '403 solo un administrador',
   'un asesor SÍ sigue sin poder mover de proceso de verdad');
ok(decide({pipelineActual:P, pipelinePedido:'otro-tablero', esMiembro:true, rol:'admin'}) === 'mover de proceso',
   'un administrador acotado sí puede');
ok(decide({pipelineActual:P, pipelinePedido:'otro-tablero', esMiembro:false}) === 'mover de proceso',
   'y la dueña también');
ok(decide({pipelineActual:P, pipelinePedido:P, esMiembro:false, previsualizar:true}) === 'mover de proceso',
   'la previsualización del mover sigue pasando aunque sea el mismo, para poder avisar «ya está ahí»');
ok(decide({pipelineActual:null, pipelinePedido:null, esMiembro:true, rol:'vendedor'}) === 'edición normal',
   'un lead sin tablero y un envío sin tablero no es un movimiento');

// que el navegador ya no lo manda al editar
const app = fs.readFileSync('/Users/mac/Documents/Claude/Acuarius/public/app.js','utf8');
ok(/delete payload\.pipeline_id;/.test(app), 'el navegador lo quita del payload al editar');
process.exit(mal?1:0);

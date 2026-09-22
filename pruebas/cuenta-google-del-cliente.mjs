// Que la cuenta de Google salga del cliente elegido y nunca de la memoria.
import fs from 'fs';
globalThis.window = {}; globalThis.document = { getElementById: () => null };
const mem = { ads_customer_id: '7496123582' };   // lo que quedó de OTRO cliente
globalThis.sessionStorage = { getItem: k => mem[k] ?? null, setItem: () => {}, removeItem: () => {} };
globalThis.localStorage  = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.agencyClients = [
  { id: 'ac_forest',   name: 'Forest Living', googleCustomerId: '1628587888' },
  { id: 'ac_acuarius', name: 'Acuarius',      googleCustomerId: '' },
  { id: 'ac_beatriz',  name: 'Beatriz Camacho' },
];
const s = fs.readFileSync('/Users/mac/Documents/Claude/Acuarius/public/app.js','utf8');
const i = s.indexOf('function cuentaGoogleDelCliente(');
let d=0,j=s.indexOf('{',i); for(let k=j;k<s.length;k++){if(s[k]==='{')d++;else if(s[k]==='}'){d--;if(!d){j=k;break;}}}
const f = eval('(' + s.slice(i, j+1) + ')');

let mal=0; const ok=(c,m)=>{console.log((c?'  ✓ ':'  ✗ ')+m); if(!c)mal++;};
const a = f('ac_forest');
ok(a.id === '1628587888', 'un cliente CON cuenta devuelve la suya: ' + a.id);
const b = f('ac_acuarius');
ok(b.id === '' && b.deEseCliente === true, 'un cliente con la cuenta vacía NO hereda la de la memoria (' + mem.ads_customer_id + ') → ' + JSON.stringify(b.id));
ok(b.nombre === 'Acuarius', 'y se sabe de qué cliente es, para poder decirlo: ' + b.nombre);
const c = f('ac_beatriz');
ok(c.id === '', 'un cliente sin el campo siquiera, tampoco');
const e = f(null);
ok(e.id === '7496123582' && e.deEseCliente === false, 'sin cliente elegido SÍ vale la memoria: es la cuenta Pro de una sola cuenta');
const g = f('ac_inexistente');
ok(g.id === '' , 'un cliente que ya no existe no hereda nada');
process.exit(mal?1:0);

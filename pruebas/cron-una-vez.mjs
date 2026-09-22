import fs from 'fs';
for (const l of fs.readFileSync(process.argv[2]+'/.env','utf8').split('\n')) { const i=l.indexOf('='); if(i>0) process.env[l.slice(0,i)]=l.slice(i+1); }
const { yaSeHizo, periodoDe } = await import('/Users/mac/Documents/Claude/Acuarius/api/_una-vez.js');
const SB=process.env.SUPABASE_URL, K=process.env.SUPABASE_SERVICE_KEY;
const H={apikey:K,Authorization:'Bearer '+K};
let mal=0; const ok=(c,m)=>{console.log((c?'  ✓ ':'  ✗ ')+m); if(!c)mal++;};
const clave = 'PRUEBA:' + Date.now();
await fetch(`${SB}/rest/v1/cron_envios?clave=like.PRUEBA*`, {method:'DELETE',headers:H});

ok(await yaSeHizo(SB,K,clave,'2026-09-22') === false, 'la primera vez deja pasar');
ok(await yaSeHizo(SB,K,clave,'2026-09-22') === true,  'la segunda lo corta — es el duplicado que se evita');
ok(await yaSeHizo(SB,K,clave,'2026-09-23') === false, 'al día siguiente vuelve a pasar');
ok(await yaSeHizo(SB,K,clave+':otro','2026-09-22') === false, 'y a otra persona no le afecta');
ok(periodoDe('dia','2026-09-22T10:00:00Z'?new Date('2026-09-22T10:00:00Z'):undefined) === '2026-09-22', 'período diario');
ok(periodoDe('mes', new Date('2026-09-22T10:00:00Z')) === '2026-09', 'período mensual');
ok(/^2026-W\d\d$/.test(periodoDe('semana', new Date('2026-09-22T10:00:00Z'))), 'período semanal: ' + periodoDe('semana', new Date('2026-09-22T10:00:00Z')));
ok(periodoDe('semana', new Date('2026-09-21T00:00:00Z')) === periodoDe('semana', new Date('2026-09-25T00:00:00Z')),
   'lunes y viernes de la misma semana dan el mismo período');
await fetch(`${SB}/rest/v1/cron_envios?clave=like.PRUEBA*`, {method:'DELETE',headers:H});
process.exit(mal?1:0);

// Un miembro del equipo hereda el plan del dueño en SEO y GEO.
import fs from 'fs';
for (const l of fs.readFileSync(process.argv[2]+'/.env','utf8').split('\n')) { const i=l.indexOf('='); if(i>0) process.env[l.slice(0,i)]=l.slice(i+1); }
const SB=process.env.SUPABASE_URL, K=process.env.SUPABASE_SERVICE_KEY;
const H={apikey:K,Authorization:'Bearer '+K};
let mal=0; const ok=(c,m)=>{console.log((c?'  ✓ ':'  ✗ ')+m); if(!c)mal++;};

// el ayudante, extraído de los ficheros reales
function sacar(f) {
  const s = fs.readFileSync('/Users/mac/Documents/Claude/Acuarius/'+f,'utf8');
  const i = s.indexOf('async function duenoDe(');
  let d=0,j=s.indexOf('{',i); for(let k=j;k<s.length;k++){if(s[k]==='{')d++;else if(s[k]==='}'){d--;if(!d){j=k;break;}}}
  return eval('(' + s.slice(i,j+1) + ')');
}
const duenoDe = sacar('api/geo-rank.js');

const ASESORA='user_3HmDHM5d0TB2I4DQbCY91jQsoOc';   // asesor1@certainpezzano — plan pro propio
const DUENA='user_3HYi3uHYQyth190Tr2HXZKmHbTk';     // Certain & Pezzano — plan agency
ok(await duenoDe(ASESORA) === DUENA, 'la asesora se resuelve a su dueña');
ok(await duenoDe(DUENA) === null, 'la dueña no tiene dueño por encima');
ok(await duenoDe('user_inventado') === null, 'un usuario que no es de nadie, tampoco');

// y que los dos ficheros lo usen de verdad
for (const f of ['api/geo-rank.js','api/seo-rank.js']) {
  const s = fs.readFileSync('/Users/mac/Documents/Claude/Acuarius/'+f,'utf8');
  ok(/const duenoId = await duenoDe\(payload\.sub\);/.test(s), f.split('/')[1] + ': consulta al dueño');
  ok(/PAID_PLANS\.includes\(planDueno\)/.test(s), f.split('/')[1] + ': y acepta su plan');
  ok(s.indexOf('duenoDe') < s.indexOf('const plan ='), f.split('/')[1] + ': el ayudante está definido antes de usarse');
}

// los siete asesores cuyo plan caduca en días
const enPrueba = [];
for (const e of ['asesora','asesora2','asesora3','mpalacios','kmatute','ccomercialoperativa','asesor']) {
  const r = await fetch(`https://api.clerk.com/v1/users?email_address=${e}@certainpezzano.com`,
    {headers:{Authorization:'Bearer '+process.env.CLERK_SECRET_KEY}}).then(r=>r.json());
  if (r[0] && (r[0].public_metadata||{}).plan === 'trial') enPrueba.push(e);
}
ok(enPrueba.length === 7, 'los siete asesores siguen en prueba, y el 28-29 pasan a free: ' + enPrueba.length);
ok(await duenoDe((await fetch('https://api.clerk.com/v1/users?email_address=asesora@certainpezzano.com',
  {headers:{Authorization:'Bearer '+process.env.CLERK_SECRET_KEY}}).then(r=>r.json()))[0].id) === DUENA,
  'y todos resuelven a la cuenta que sí paga');
process.exit(mal?1:0);

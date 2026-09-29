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

// Los miembros del equipo de Certain, que no pagan licencia propia.
//
// Esto era una foto con fecha —«los siete siguen en prueba, y el 28-29 pasan a
// free»— y caducó sola: pasado ese día la línea era cierta pasara lo que
// pasara. Su sustituta escribía los siete correos a mano, y eso también miente
// en cuanto el equipo cambia: uno de ellos ya no está en el equipo, así que la
// prueba exigía que heredase un permiso que le toca no tener.
//
// Ahora la lista sale de la base. Lo que hay que sostener no tiene fecha: el
// plan personal de cada uno da igual, porque el permiso lo hereda de la cuenta
// que paga.
const equipo = await fetch(
  `${SB}/rest/v1/team_members?owner_user_id=eq.${DUENA}&status=eq.active` +
  `&member_user_id=not.is.null&select=member_user_id,member_email`,
  { headers: H }).then(r => r.json());

// Si la consulta se cayera, la lista vacía dejaría pasar la prueba sin
// comprobar nada, que es peor que un fallo.
ok(Array.isArray(equipo) && equipo.length > 0, 'el equipo de la dueña se pudo consultar: ' + (equipo?.length ?? 'error'));

for (const m of equipo || []) {
  ok(await duenoDe(m.member_user_id) === DUENA, `${m.member_email} hereda el permiso de la cuenta que paga`);
}

// Y quien NO está en el equipo no hereda nada, que es la otra mitad: un
// ayudante que devolviera siempre a la dueña pasaría todo lo de arriba.
const suelto = await fetch(
  `${SB}/rest/v1/team_members?member_email=eq.asesora3@certainpezzano.com&select=member_user_id`,
  { headers: H }).then(r => r.json());
ok(Array.isArray(suelto) && suelto.length === 0,
   'asesora3@certainpezzano.com sigue fuera del equipo (tiene cuenta propia en free)');

process.exit(mal?1:0);

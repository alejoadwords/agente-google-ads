// Reproduce el modo «¿ya existe?» del endpoint contra la base real, con la
// cuenta de Certain & Pezzano y sus asesoras de verdad.
import fs from 'fs';
for (const l of fs.readFileSync(process.argv[2]+'/.env','utf8').split('\n')) { const i=l.indexOf('='); if(i>0) process.env[l.slice(0,i)]=l.slice(i+1); }
const SB=process.env.SUPABASE_URL, K=process.env.SUPABASE_SERVICE_KEY;
const H={apikey:K,Authorization:'Bearer '+K};
const U='user_3HYi3uHYQyth190Tr2HXZKmHbTk';              // el dueño
const CLI='pro_main';                                     // sus leads viven en este ámbito
const ASESORA='user_3HmDHM5d0TB2I4DQbCY91jQsoOc';        // Maira, perfil ventas
let mal=0; const ok=(c,m)=>{console.log((c?'  ✓ ':'  ✗ ')+m); if(!c)mal++;};

// el código del endpoint, tal cual
async function existe(q, actorId) {
  if (q.trim().length < 3) return { coincidencias: [], corto: true };
  const como = `*${q.replace(/[(),*]/g,' ')}*`;
  const filas = await fetch(`${SB}/rest/v1/leads?user_id=eq.${U}&client_id=eq.${CLI}&deleted_at=is.null` +
    `&or=(name.ilike.${encodeURIComponent(como)},company.ilike.${encodeURIComponent(como)},email.ilike.${encodeURIComponent(como)},phone.ilike.${encodeURIComponent(como)})` +
    `&select=id,name,company,stage,pipeline_id,assigned_to,assigned_name&order=created_at.desc&limit=10`,{headers:H}).then(r=>r.json());
  const etapas={}; const pipes=[...new Set(filas.map(f=>f.pipeline_id).filter(Boolean))];
  if (pipes.length) {
    const st = await fetch(`${SB}/rest/v1/pipeline_stages?pipeline_id=in.(${pipes.join(',')})&select=pipeline_id,key,label`,{headers:H}).then(r=>r.json());
    for (const e of st) etapas[e.pipeline_id+'|'+e.key]=e.label;
  }
  return { coincidencias: filas.map(f=>({ id:f.id, name:f.name, company:f.company,
    etapa: etapas[f.pipeline_id+'|'+f.stage] || f.stage, asesor: f.assigned_name||null,
    mio: !!f.assigned_to && f.assigned_to===actorId })) };
}

// un lead que NO es de Maira
const ajeno = (await fetch(`${SB}/rest/v1/leads?user_id=eq.${U}&client_id=eq.${CLI}&assigned_to=not.eq.${ASESORA}&assigned_to=not.is.null&select=name,email,phone,assigned_name,stage&limit=1`,{headers:H}).then(r=>r.json()))[0];
console.log('  lead de prueba:', ajeno.name, '· de', ajeno.assigned_name, '\n');

const r = await existe(ajeno.name.split(' ')[0], ASESORA);
const c = r.coincidencias.find(x => x.name === ajeno.name);
ok(!!c, 'la asesora SÍ lo encuentra aunque no sea suyo');
ok(!!c && !!c.etapa && c.etapa !== ajeno.stage, 've la etapa con su nombre propio, no la clave: «' + (c&&c.etapa) + '»');
ok(!!c && c.asesor === ajeno.assigned_name, 'y de quién es: ' + (c&&c.asesor));
ok(!!c && c.mio === false, 'marcado como NO suyo, para no repetirlo en el tablero');

const campos = Object.keys(c||{});
ok(!campos.includes('email') && !campos.includes('phone'), 'NO llega el correo ni el teléfono');
ok(!campos.includes('value') && !campos.includes('notes') && !campos.includes('tags'),
   'ni el valor, ni las notas, ni las etiquetas · campos devueltos: ' + campos.join(', '));

ok((await existe('ab', ASESORA)).corto === true, 'con menos de 3 letras no busca: «buscar» con una letra es listar la base');
const muchos = await existe('a', ASESORA);
ok(muchos.corto === true, 'una sola letra tampoco');
const tope = await existe('ma', ASESORA);
ok(tope.corto === true, 'dos letras tampoco');
const diez = await existe('mar', ASESORA);
ok(diez.coincidencias.length <= 10, 'el tope son 10 resultados · devolvió ' + diez.coincidencias.length);

// uno propio SÍ se marca como suyo
const propio = (await fetch(`${SB}/rest/v1/leads?user_id=eq.${U}&client_id=eq.${CLI}&assigned_to=eq.${ASESORA}&select=name&limit=1`,{headers:H}).then(r=>r.json()))[0];
if (propio) {
  const rp = await existe(propio.name.split(' ')[0], ASESORA);
  ok(rp.coincidencias.some(x => x.name === propio.name && x.mio === true), 'un lead suyo sí sale marcado como suyo');
}
process.exit(mal?1:0);

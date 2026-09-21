// Circuito completo contra la base real: configurar → enviar → responder →
// ver el reporte. Sin pasar por el navegador, pero con el código de verdad.
import fs from 'fs';
for (const l of fs.readFileSync(process.argv[2]+'/.env','utf8').split('\n')) { const i=l.indexOf('='); if(i>0) process.env[l.slice(0,i)]=l.slice(i+1); }
const SB=process.env.SUPABASE_URL, K=process.env.SUPABASE_SERVICE_KEY;
const H={apikey:K,Authorization:'Bearer '+K,'Content-Type':'application/json'};
const { leerNps, normalizarNps, NPS_KEY } = await import('/Users/mac/Documents/Claude/Acuarius/api/_nps.js');

const U = 'user_PRUEBA_nps';
const limpiar = async () => {
  await fetch(`${SB}/rest/v1/nps_responses?user_id=eq.${U}`, {method:'DELETE',headers:H});
  await fetch(`${SB}/rest/v1/user_profiles?user_id=eq.${U}`, {method:'DELETE',headers:H});
  await fetch(`${SB}/rest/v1/users?id=eq.${U}`, {method:'DELETE',headers:H});
};
// user_profiles tiene clave foránea a users: sin la cuenta, el upsert da 409.
const crearCuenta = async () => {
  const r = await fetch(`${SB}/rest/v1/users`, {method:'POST',headers:{...H,Prefer:'return=minimal'},
    body: JSON.stringify({ id: U, email: 'prueba-nps@acuarius.test' })});
  if (!r.ok) { console.log('  ✗ no se pudo crear la cuenta de prueba:', (await r.text()).slice(0,140)); process.exit(1); }
};
let mal=0; const ok=(c,m)=>{console.log((c?'  ✓ ':'  ✗ ')+m); if(!c)mal++;};
await limpiar();
await crearCuenta();

// 1) el cliente configura su encuesta
const cfg = normalizarNps({
  pregunta: '¿Nos recomendarías a otro colegio?',
  gracias: 'Gracias, anotamos tu {nota}',
  color: '#0F766E',
  preguntas: [
    { id:'pa', tipo:'escala5', texto:'¿Cómo fue la atención?' },
    { id:'pb', tipo:'texto',   texto:'¿Qué mejorarías?' },
  ],
});
await fetch(`${SB}/rest/v1/user_profiles?on_conflict=user_id,agent_key`, {
  method:'POST', headers:{...H,Prefer:'resolution=merge-duplicates,return=minimal'},
  body: JSON.stringify({ user_id:U, agent_key:NPS_KEY, profile_data:{ _cuenta: cfg } }),
});
const leida = await leerNps(SB, K, U, null);
ok(leida.pregunta === '¿Nos recomendarías a otro colegio?', 'la configuración se guarda y se relee');
ok(leida.preguntas.length === 2 && leida.color === '#0F766E', 'con sus 2 preguntas y su color');

// 2) se envían tres encuestas, cada una con COPIA de las preguntas
const tokens = [];
for (let i=0;i<3;i++) {
  const t = crypto.randomUUID().replace(/-/g,'');
  tokens.push(t);
  await fetch(`${SB}/rest/v1/nps_responses`, {method:'POST',headers:{...H,Prefer:'return=minimal'},
    body: JSON.stringify({ user_id:U, lead_id:null, token:t, preguntas: leida.preguntas })});
}
ok(tokens.length===3, 'tres encuestas enviadas con su copia de preguntas');

// 3) responden: notas y respuestas a las extra
const respuestas = [
  { nota:10, pa:5, pb:'Todo perfecto' },
  { nota:8,  pa:4, pb:'El horario' },
  { nota:3,  pa:2, pb:'Tardan en contestar' },
];
for (let i=0;i<3;i++) {
  const r = respuestas[i];
  await fetch(`${SB}/rest/v1/nps_responses?token=eq.${tokens[i]}`, {method:'PATCH',headers:{...H,Prefer:'return=minimal'},
    body: JSON.stringify({ score:r.nota, responded_at:new Date().toISOString(), comment:r.pb, answers:{ pa:r.pa, pb:r.pb } })});
}

// 4) el reporte: se replica la agregación del endpoint
const filas = await fetch(`${SB}/rest/v1/nps_responses?user_id=eq.${U}&select=score,comment,responded_at,sent_at,lead_id,answers,preguntas`, {headers:H}).then(r=>r.json());
const cont = filas.filter(r=>r.score!=null);
const prom = cont.filter(r=>r.score>=9).length, det = cont.filter(r=>r.score<=6).length;
const nps = Math.round(((prom-det)/cont.length)*100);
ok(nps === 0, 'el NPS sale bien: 1 promotor − 1 detractor de 3 = 0 · dio ' + nps);

const notasPa = filas.map(r=>r.answers?.pa).filter(Boolean);
const media = Math.round((notasPa.reduce((a,b)=>a+b,0)/notasPa.length)*10)/10;
ok(media === 3.7, 'la escala se promedia: (5+4+2)/3 = 3.7 · dio ' + media);
ok(filas.every(r => Array.isArray(r.preguntas) && r.preguntas.length===2), 'cada respuesta guarda a qué se le preguntó');

// 5) la prueba de verdad: se CAMBIA la pregunta y lo viejo no se reetiqueta
const cfg2 = normalizarNps({ ...cfg, preguntas:[{ id:'pa', tipo:'escala5', texto:'¿Cómo te atendimos?' }] });
await fetch(`${SB}/rest/v1/user_profiles?user_id=eq.${U}&agent_key=eq.${NPS_KEY}`, {method:'PATCH',headers:{...H,Prefer:'return=minimal'},
  body: JSON.stringify({ profile_data:{ _cuenta: cfg2 } })});
const viejas = await fetch(`${SB}/rest/v1/nps_responses?user_id=eq.${U}&select=preguntas&limit=1`, {headers:H}).then(r=>r.json());
ok(viejas[0].preguntas[0].texto === '¿Cómo fue la atención?',
   'tras reescribir la pregunta, las respuestas viejas siguen diciendo a qué contestaban');

await limpiar();
process.exit(mal?1:0);

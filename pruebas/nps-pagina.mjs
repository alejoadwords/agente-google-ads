import fs from 'fs';
for (const l of fs.readFileSync(process.argv[2]+'/.env','utf8').split('\n')) { const i=l.indexOf('='); if(i>0) process.env[l.slice(0,i)]=l.slice(i+1); }
const SB=process.env.SUPABASE_URL, K=process.env.SUPABASE_SERVICE_KEY;
const H={apikey:K,Authorization:'Bearer '+K,'Content-Type':'application/json'};
const { normalizarNps, NPS_KEY } = await import('/Users/mac/Documents/Claude/Acuarius/api/_nps.js');
const handler = (await import('/Users/mac/Documents/Claude/Acuarius/api/nps.js')).default;

const U='user_PRUEBA_nps', TOKEN='aa11bb22cc33dd44ee55ff66';
const limpiar = async () => {
  for (const t of ['nps_responses?user_id=eq.'+U, 'user_profiles?user_id=eq.'+U, 'users?id=eq.'+U])
    await fetch(`${SB}/rest/v1/${t}`, {method:'DELETE',headers:H});
};
await limpiar();
await fetch(`${SB}/rest/v1/users`, {method:'POST',headers:{...H,Prefer:'return=minimal'}, body:JSON.stringify({id:U,email:'prueba-nps@acuarius.test'})});

// Configuración con un intento de inyección en los textos, a propósito
const cfg = normalizarNps({
  gracias: 'Gracias, anotamos tu {nota} <script>alert(1)</script>',
  piePromotor: '¿Algo más? "comillas" & <b>negrita</b>',
  color: '#0F766E',
  boton: 'Enviar respuestas',
  preguntas: [
    { id:'pa', tipo:'escala5', texto:'¿Cómo fue la atención?', obligatoria:true },
    { id:'pb', tipo:'texto',   texto:'¿Qué mejorarías?' },
  ],
});
await fetch(`${SB}/rest/v1/user_profiles`, {method:'POST',headers:{...H,Prefer:'return=minimal'},
  body:JSON.stringify({user_id:U,agent_key:NPS_KEY,profile_data:{_cuenta:cfg}})});
await fetch(`${SB}/rest/v1/nps_responses`, {method:'POST',headers:{...H,Prefer:'return=minimal'},
  body:JSON.stringify({user_id:U,token:TOKEN,preguntas:cfg.preguntas})});

let mal=0; const ok=(c,m)=>{console.log((c?'  ✓ ':'  ✗ ')+m); if(!c)mal++;};

// ── La página al pulsar un 10 ──
const res = await handler(new Request('https://app.acuarius.app/api/nps?t='+TOKEN+'&s=10'));
const html = await res.text();
fs.writeFileSync(process.argv[2]+'/nps-pagina.html', html);
ok(res.status===200, 'la página responde 200');
ok(html.includes('Gracias, anotamos tu 10'), '{nota} se reemplaza por la nota elegida');
ok(!html.includes('<script>alert(1)</script>'), 'un <script> en los textos NO se ejecuta');
ok(html.includes('&lt;script&gt;'), 'sale escapado, a la vista');
ok(html.includes('¿Cómo fue la atención?') && html.includes('¿Qué mejorarías?'), 'salen las dos preguntas extra');
ok((html.match(/name="q_pa"/g)||[]).length===5, 'la escala 1-5 pinta 5 opciones');
ok(html.includes('name="q_pb"'), 'la de texto pinta su campo');
ok(html.includes('#0F766E'), 'usa el color de la cuenta');
ok(html.includes('Enviar respuestas'), 'y el texto del botón');
ok(html.includes('required'), 'la pregunta obligatoria lo pide');
// el onclick de las escalas: comillas bien cerradas
const oc = html.match(/onclick="[^"]*"/g) || [];
ok(oc.length>0 && oc.every(o => (o.match(/&#39;|'/g)||[]).length % 2 === 0), 'los onclick tienen las comillas pareadas');

// ── Enviar el formulario ──
const body = new URLSearchParams({ q_pa:'4', q_pb:'Más rápido por favor', comment:'Todo bien' });
const res2 = await handler(new Request('https://app.acuarius.app/api/nps?t='+TOKEN, {
  method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: body.toString() }));
ok(res2.status===200, 'el envío responde 200');
const fila = (await fetch(`${SB}/rest/v1/nps_responses?token=eq.${TOKEN}&select=*`,{headers:H}).then(r=>r.json()))[0];
ok(fila.score===10, 'la nota quedó guardada');
ok(fila.answers?.pa===4, 'la escala se guarda como número · ' + JSON.stringify(fila.answers?.pa));
ok(fila.answers?.pb==='Más rápido por favor', 'el texto se guarda');
ok(fila.comment==='Todo bien', 'y el comentario');

// un valor fuera de rango en la escala no entra
await fetch(`${SB}/rest/v1/nps_responses?token=eq.${TOKEN}`,{method:'PATCH',headers:{...H,Prefer:'return=minimal'},body:JSON.stringify({answers:null})});
await handler(new Request('https://app.acuarius.app/api/nps?t='+TOKEN,{method:'POST',
  headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({q_pa:'99'}).toString()}));
const f2 = (await fetch(`${SB}/rest/v1/nps_responses?token=eq.${TOKEN}&select=answers`,{headers:H}).then(r=>r.json()))[0];
ok(!f2.answers || f2.answers.pa===undefined, 'una escala con 99 se descarta, no se guarda basura');

await limpiar();
process.exit(mal?1:0);

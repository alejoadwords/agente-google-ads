import fs from 'fs';
for (const l of fs.readFileSync(process.argv[2]+'/.env','utf8').split('\n')) { const i=l.indexOf('='); if(i>0) process.env[l.slice(0,i)]=l.slice(i+1); }
const SB=process.env.SUPABASE_URL, K=process.env.SUPABASE_SERVICE_KEY, DEV=process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
const H={apikey:K,Authorization:'Bearer '+K};
const { abrirConexion } = await import('/Users/mac/Documents/Claude/Acuarius/api/_cifrado.js');
const { dondePreguntar } = await import('/Users/mac/Documents/Claude/Acuarius/api/_google-login.js');
const U='user_3BbRjDirO2tkeRY2O8ByYpWFnPR';
const fila = await abrirConexion((await fetch(`${SB}/rest/v1/platform_connections?user_id=eq.${U}&platform=eq.google_ads&select=*`,{headers:H}).then(r=>r.json()))[0]);
const t = await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,refresh_token:fila.refresh_token,grant_type:'refresh_token'})}).then(r=>r.json());
if(!t.access_token){console.log('  ✗ token:',JSON.stringify(t).slice(0,160));process.exit(1);}
const token=t.access_token;

const la = await fetch('https://googleads.googleapis.com/v22/customers:listAccessibleCustomers',
  {headers:{Authorization:'Bearer '+token,'developer-token':DEV}}).then(r=>r.json());
const alcance = (la.resourceNames||[]).map(n=>n.split('/').pop());
console.log('  cuentas de PRIMERA mano:', alcance.length, '→', alcance.join(', '), '\n');

const pedir = async (cid, login) => {
  const h={Authorization:'Bearer '+token,'developer-token':DEV,'Content-Type':'application/json'};
  if(login) h['login-customer-id']=login;
  const r=await fetch(`https://googleads.googleapis.com/v22/customers/${cid}/googleAds:search`,{method:'POST',headers:h,
    body:JSON.stringify({query:'SELECT campaign.id FROM campaign LIMIT 1'})});
  const d=await r.json().catch(()=>({}));
  return d.error ? 'ERROR ' + (d.error.message||'').slice(0,42) : ((d.results||[]).length + ' campañas');
};

for (const [nombre,cid] of [['Forest Living','1628587888'],['Iluminata','1274359952'],['Arké','2759109092'],
                            ['UGASEND','7496123582'],['SeguroBici','3028094807'],['Travel Rent a Car','9113810950'],
                            ['Blindaelec','7937182639']]) {
  const sin = await pedir(cid, null);
  const login = await dondePreguntar({ fila, token, customerId: cid, devToken: DEV });
  const con = login ? await pedir(cid, login) : '(no se encontró administrador)';
  console.log(`  ${nombre.padEnd(20)} ${cid}  sin cabecera: ${sin.padEnd(46)} con «${login||'—'}»: ${con}`);
}

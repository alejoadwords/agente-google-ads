import fs from 'fs';
for (const l of fs.readFileSync(process.argv[2]+'/.env','utf8').split('\n')) { const i=l.indexOf('='); if(i>0) process.env[l.slice(0,i)]=l.slice(i+1); }
const SB=process.env.SUPABASE_URL, K=process.env.SUPABASE_SERVICE_KEY, DEV=process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
const H={apikey:K,Authorization:'Bearer '+K};
const { abrirConexion } = await import('/Users/mac/Documents/Claude/Acuarius/api/_cifrado.js');
const { dondePreguntar } = await import('/Users/mac/Documents/Claude/Acuarius/api/_google-login.js');

const U='user_3HYi3uHYQyth190Tr2HXZKmHbTk';   // Certain & Pezzano
const fila = (await fetch(`${SB}/rest/v1/platform_connections?user_id=eq.${U}&platform=eq.google_ads&select=*`,{headers:H}).then(r=>r.json()))[0];
const abierta = await abrirConexion(fila);

// token fresco
const t = await fetch('https://oauth2.googleapis.com/token',{method:'POST',
  headers:{'Content-Type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,
    refresh_token:abierta.refresh_token,grant_type:'refresh_token'})}).then(r=>r.json());
if (!t.access_token) { console.log('  ✗ no se pudo refrescar el token:', JSON.stringify(t).slice(0,150)); process.exit(1); }
const token = t.access_token, cid = String(fila.account_id);
let mal=0; const ok=(c,m)=>{console.log((c?'  ✓ ':'  ✗ ')+m); if(!c)mal++;};

async function pedir(login) {
  const h = { Authorization:'Bearer '+token, 'developer-token':DEV, 'Content-Type':'application/json' };
  if (login) h['login-customer-id'] = login;
  const r = await fetch(`https://googleads.googleapis.com/v22/customers/${cid}/googleAds:search`,
    { method:'POST', headers:h, body: JSON.stringify({ query:'SELECT campaign.id, campaign.name FROM campaign LIMIT 5' }) });
  const d = await r.json().catch(()=>({}));
  return { status: r.status, n: (d.results||[]).length, err: d.error ? JSON.stringify(d.error).slice(0,70) : null };
}

console.log('  cuenta de Certain:', cid, '\n');
const a = await pedir(null);
ok(!!a.err, 'intento 1 — SIN cabecera: falla, como en producción  → ' + (a.err || a.n + ' campañas'));
const b = await pedir(String(process.env.GOOGLE_ADS_MCC_ID || '').replace(/-/g,'') || '0000000000');
ok(!!b.err, 'intento 2 — con NUESTRO administrador: también falla → ' + (b.err || b.n + ' campañas'));

const login = await dondePreguntar({ fila, token, customerId: cid, devToken: DEV, sbUrl: SB, sbKey: K });
ok(login === '1007557246', 'el módulo devuelve el administrador del cliente: ' + login);
const c = await pedir(login);
ok(!c.err && c.n > 0, 'intento 3 — con el suyo: FUNCIONA → ' + (c.err || c.n + ' campañas'));
process.exit(mal?1:0);

// La caché: que una cuenta no se lleve por delante el administrador de otra.
const mod = await import('/Users/mac/Documents/Claude/Acuarius/api/_google-login.js?v=' + Date.now());
let mal=0; const ok=(c,m)=>{console.log((c?'  ✓ ':'  ✗ ')+m); if(!c)mal++;};
let llamadas = 0;
globalThis.fetch = async (url) => {
  llamadas++;
  if (String(url).includes('listAccessibleCustomers'))
    return { ok:true, json: async () => ({ resourceNames:['customers/999'] }) };
  if (String(url).includes('googleAds:search'))
    return { ok:true, json: async () => ({ results:[{customerClient:{id:'111'}}] }) };
  return { ok:true, json: async () => ({}) };   // el PATCH de guardado
};
const base = { id:'c1', account_id:null, extra_data:{} };

// 111 cuelga del administrador 999
const a = await mod.dondePreguntar({ fila: base, token:'t', customerId:'111', devToken:'d' });
ok(a === '999', 'encuentra el administrador de la cuenta 111: ' + a);

// 222 NO cuelga de él, y la caché de 111 no debe contestarle
const conCache = { ...base, extra_data:{ login_por_cuenta: { '111': '999' } } };
llamadas = 0;
const b = await mod.dondePreguntar({ fila: conCache, token:'t', customerId:'111', devToken:'d' });
ok(b === '999' && llamadas === 0, 'para 111 responde de la caché sin llamar a Google · llamadas: ' + llamadas);

llamadas = 0;
const c = await mod.dondePreguntar({ fila: conCache, token:'t', customerId:'222', devToken:'d' });
ok(llamadas > 0, 'para 222 SÍ busca: la caché de otra cuenta no le sirve · llamadas: ' + llamadas);
ok(c === null, 'y como 222 no cuelga de 999, devuelve null en vez del administrador equivocado: ' + c);

// la casilla vieja solo vale para la cuenta de la conexión
const viejo = { id:'c1', account_id:'111', extra_data:{ login_customer_id:'999' } };
llamadas = 0;
ok(await mod.dondePreguntar({ fila: viejo, token:'t', customerId:'111', devToken:'d' }) === '999' && llamadas === 0,
   'la casilla vieja sigue valiendo para la cuenta de la conexión');
llamadas = 0;
await mod.dondePreguntar({ fila: viejo, token:'t', customerId:'333', devToken:'d' });
ok(llamadas > 0, 'pero NO se aplica a otra cuenta · llamadas: ' + llamadas);
process.exit(mal?1:0);

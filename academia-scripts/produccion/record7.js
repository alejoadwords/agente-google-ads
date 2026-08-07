const { chromium } = require('playwright');
const fs = require('fs');
const durs = JSON.parse(fs.readFileSync('audio/durations.json', 'utf8'));
const CURSOR = `(() => { if (window.__c) return; window.__c = true;
  const d = document.createElement('div');
  d.style.cssText='position:fixed;z-index:2147483647;width:22px;height:22px;border-radius:50%;background:rgba(30,43,204,.25);border:2.5px solid #1E2BCC;pointer-events:none;transform:translate(-50%,-50%);transition:width .12s,height .12s;top:-50px;left:-50px';
  const add=()=>document.body&&document.body.appendChild(d);
  document.body?add():document.addEventListener('DOMContentLoaded',add);
  addEventListener('mousemove',e=>{d.style.left=e.clientX+'px';d.style.top=e.clientY+'px'},true);
  addEventListener('mousedown',()=>{d.style.width='15px';d.style.height='15px'},true);
  addEventListener('mouseup',()=>{d.style.width='22px';d.style.height='22px'},true);})();`;
const PROFILE = cid => ([{ id:'pro_main', name:'Tierra de Mascotas', pais:'Colombia', ciudad:'Bogotá',
  web:'https://tierrademascotas.com', industria:'E-commerce / Retail',
  descripcion:'Tienda de productos para mascotas en Bogotá: alimento, accesorios y servicios de spa canino.',
  objetivo:'Aumentar ventas en línea y visitas a tienda', presupuesto:'2000',
  ticket:'150.000 COP', ciclo:'Corto (menos de 1 semana)', competidores:'Agrocampo, Kanu Pet, Petco',
  audiencia:'Dueños de mascotas en Bogotá, 25-55 años.',
  googleCustomerId:cid, googleAccountName:'Tierra de Mascotas', health:'verde',
  createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() }]);

(async () => {
  const safe = async (pg,u) => { try { await pg.goto(u,{waitUntil:'domcontentloaded',timeout:45000}); } catch(e){} };
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{width:1920,height:1080}, storageState:'state.json',
    recordVideo:{ dir:'rec', size:{width:1920,height:1080} } });
  const page = await ctx.newPage();
  await page.addInitScript(CURSOR);
  await page.addInitScript(({tok,cid,uid,prof}) => {
    sessionStorage.setItem('ads_access_token',tok); sessionStorage.setItem('ads_customer_id',cid); sessionStorage.setItem('ads_currency','COP');
    localStorage.setItem('ads_access_token_persist',tok); localStorage.setItem('ads_customer_id_persist',cid); localStorage.setItem('ads_currency_persist','COP');
    localStorage.setItem('acuarius_agency_clients_'+uid, JSON.stringify(prof));
  }, { tok:process.env.GADS_AT, cid:'3826364131', uid:'user_3EflFgW3t8ps6J0OQfLB2u8l674', prof:PROFILE('3826364131') });

  const T0 = Date.now(); const at = () => (Date.now()-T0)/1000; const mark = {};
  await safe(page,'https://app.acuarius.app/');
  await page.waitForTimeout(9000);
  try { const b=page.locator('text=omitir tour'); if (await b.isVisible({timeout:2500})) { await b.click(); await page.waitForTimeout(1000);} } catch(e){}
  await page.getByText('Análisis, keywords, búsquedas y optimización').first().click();
  await page.waitForTimeout(6500);
  mark.start = at(); console.log('inicio @', mark.start.toFixed(1));

  const move = async (sel, steps=26) => { try {
      const l = typeof sel==='string'?page.locator(sel).first():sel;
      await l.waitFor({state:'visible',timeout:5000}); await l.scrollIntoViewIfNeeded({timeout:5000});
      const b = await l.boundingBox(); if (b) await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps}); return b;
    } catch(e){ console.log('movefail',String(sel).slice(0,40)); return null; } };
  const click = async sel => { const b = await move(sel); if(!b) return false;
    await page.waitForTimeout(220); await page.mouse.down(); await page.waitForTimeout(85); await page.mouse.up(); return true; };
  let s0; const begin = n => { s0=Date.now(); console.log('scene',n,'@',at().toFixed(1)); };
  const hold = async (n,extra=0) => { const l = durs[n]*1000+extra-(Date.now()-s0); if(l>0) await page.waitForTimeout(l); };
  const esperar = async (fn, seg=300) => { for (let i=0;i<seg*2;i++){ if (await fn().catch(()=>false)) return true; await page.waitForTimeout(500);} return false; };

  // g1 — presentación
  begin('g1');
  await page.mouse.move(960,420,{steps:30}); await page.waitForTimeout(5000);
  await move(page.getByPlaceholder('pregunta al agente o adjunta una captura...'),28);
  await hold('g1');

  // g2 — escribir la petición
  begin('g2');
  const inp = page.getByPlaceholder('pregunta al agente o adjunta una captura...');
  await click(inp);
  await page.keyboard.type('Crea una campaña de búsqueda para promocionar el spa canino. Presupuesto 30.000 COP diarios, solo Bogotá, en español. La URL es tierrademascotas.com', { delay: 26 });
  await hold('g2', -900);
  await page.keyboard.press('Enter');
  mark.sent = at(); console.log('ENVIADO @', mark.sent.toFixed(1));

  // g3 — narración mientras trabaja
  begin('g3');
  await page.mouse.move(700,700,{steps:25});
  await hold('g3');
  mark.cutFrom = at();

  const listo = await esperar(() => page.locator('#cb-create-btn').first().isVisible({timeout:800}), 300);
  console.log('panel de campaña:', listo, '@', at().toFixed(1));
  if (!listo) { console.log('ABORTO: no apareció el panel'); await ctx.close(); await browser.close(); process.exit(3); }
  await page.locator('#cb-create-btn').scrollIntoViewIfNeeded().catch(()=>{});
  await page.waitForTimeout(2500);
  mark.cutTo = at();

  // g4 — recorrer el panel de revisión
  begin('g4');
  await move('#cb-name',24); await page.waitForTimeout(2600);
  await move('#cb-budget',20); await page.waitForTimeout(2600);
  await move('#cb-bidding',20); await page.waitForTimeout(2600);
  await move('#cb-g0-kw',22);
  await hold('g4');

  // g5 — editar en el panel
  begin('g5');
  await move('#cb-g0-h',22); await page.waitForTimeout(1500);
  await page.mouse.wheel(0,220); await page.waitForTimeout(2500);
  await move('#cb-g0-d',22); await page.waitForTimeout(3000);
  await page.mouse.wheel(0,180);
  await hold('g5');

  // g6 — crear (nace en pausa)
  begin('g6');
  await move('#cb-create-btn',26); await page.waitForTimeout(3000);
  await hold('g6', -1600);
  await click('#cb-create-btn');
  mark.created = at(); console.log('CREAR pulsado @', mark.created.toFixed(1));

  const ok = await esperar(async () => {
    const t = await page.locator('#cb-result').innerText().catch(()=>'');
    return t.includes('creada') || t.includes('⚠️');
  }, 180);
  const resultado = await page.locator('#cb-result').innerText().catch(()=>'');
  console.log('resultado:', resultado.slice(0,160).replace(/\n/g,' | '));
  mark.cut3From = at();
  await page.waitForTimeout(2000);
  mark.cut3To = at();

  // g7 — resultado y acciones
  begin('g7');
  await move('#cb-result',26); await page.waitForTimeout(5000);
  await move(page.locator('#cb-actions').getByText(/Ver en Google Ads/i).first(),24); await page.waitForTimeout(4000);
  await move(page.locator('#cb-actions').getByText(/Activar/i).first(),22);
  await hold('g7');

  // g8 — cierre
  begin('g8');
  await page.mouse.move(960,500,{steps:40}); await page.waitForTimeout(8000);
  await move(page.getByText('hoja de ruta',{exact:false}).last(),26); await page.waitForTimeout(6000);
  await page.mouse.move(900,600,{steps:35});
  await hold('g8',1500);

  const v = page.video(); await ctx.close();
  fs.writeFileSync('recmeta.json', JSON.stringify(mark,null,1));
  console.log('video:', await v.path(), JSON.stringify(mark));
  await browser.close();
})();

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

  // h1 — presentación
  begin('h1');
  await page.mouse.move(960,420,{steps:30}); await page.waitForTimeout(4000);
  await move(page.getByText('Crear lista de keywords').first(),28);
  await hold('h1');

  // h2 — los dos caminos: la acción o pedirlo escribiendo
  begin('h2');
  await page.waitForTimeout(2500);
  const inp = page.getByPlaceholder('pregunta al agente o adjunta una captura...');
  await click(inp);
  await page.keyboard.type('Analiza el rendimiento de mis palabras clave y dime cuáles pausar, cuáles negativizar y cuáles añadir', { delay: 30 });
  await hold('h2', -900);
  await page.keyboard.press('Enter');
  mark.sent = at(); console.log('ENVIADO @', mark.sent.toFixed(1));

  // h3 — narración durante la espera
  begin('h3');
  await page.mouse.move(720,700,{steps:25});
  await hold('h3');
  mark.cutFrom = at();

  const listo = await esperar(async () => {
    const t = await page.locator('body').innerText().catch(()=>'');
    return /Ver resultado completo en el lienzo/.test(t) || !!(await page.locator('#cb-create-btn').count().catch(()=>0));
  }, 300);
  console.log('respuesta lista:', listo, '@', at().toFixed(1));
  if (!listo) { console.log('ABORTO: el agente no respondio'); await ctx.close(); await browser.close(); process.exit(3); }
  try { await page.getByText('Ver resultado completo en el lienzo').first().click({timeout:4000}); } catch(e) { console.log('sin lienzo'); }
  await page.waitForTimeout(3000);
  mark.cutTo = at();

  const smoothScroll = async (px, ms=2200) => {
    await page.evaluate(async ({px,ms}) => {
      const el = document.querySelector('.lienzo-body') || document.scrollingElement;
      if (!el) return;
      const from = el.scrollTop, steps = Math.max(12, Math.round(ms/16));
      for (let i=1;i<=steps;i++){ el.scrollTop = from + px*(i/steps); await new Promise(r=>setTimeout(r, ms/steps)); }
    }, {px,ms});
  };

  // h4 — el análisis agrupado
  begin('h4');
  await page.mouse.move(1600,420,{steps:30}); await page.waitForTimeout(6000);
  await smoothScroll(260); await page.waitForTimeout(4000);
  await smoothScroll(240);
  await hold('h4');

  // h5 — los cuatro movimientos
  begin('h5');
  await smoothScroll(300); await page.waitForTimeout(6500);
  await smoothScroll(320); await page.waitForTimeout(6500);
  await smoothScroll(300); await page.waitForTimeout(5000);
  await smoothScroll(280);
  await hold('h5');

  // h6 — panel de negativas / sugerencias
  begin('h6');
  try { await page.locator('.lienzo-header').getByText('Cerrar',{exact:false}).first().click({timeout:3000}); } catch(e){}
  await page.waitForTimeout(2000);
  const sug = page.locator('button, .sug-btn').filter({ hasText: /negativa|keyword|concordancia|search terms/i });
  const n = await sug.count().catch(()=>0);
  for (let i=0;i<Math.min(n,3);i++){ await move(sug.nth(i),22); await page.waitForTimeout(2800); }
  if (!n) { await move(page.getByText('keyword research',{exact:false}).last(),24); await page.waitForTimeout(3000); }
  await hold('h6');

  // h7 — ritmo y advertencia
  begin('h7');
  await move(page.getByText('analizar mi cuenta',{exact:false}).last(),26); await page.waitForTimeout(6000);
  await move(page.getByText('hoja de ruta',{exact:false}).last(),24); await page.waitForTimeout(6000);
  await page.mouse.move(900,600,{steps:35});
  await hold('h7');

  // h8 — cierre de categoría
  begin('h8');
  await move('#navm-marketing',26); await page.waitForTimeout(5000);
  await page.mouse.move(960,500,{steps:40});
  await hold('h8',1500);

  const v = page.video(); await ctx.close();
  fs.writeFileSync('recmeta.json', JSON.stringify(mark,null,1));
  console.log('video:', await v.path(), JSON.stringify(mark));
  await browser.close();
})();

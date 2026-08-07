const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  const safe = async u => { try { await p.goto(u, { waitUntil: 'domcontentloaded', timeout: 45000 }); } catch (e) {} };
  await safe('https://app.acuarius.app/');
  await p.waitForTimeout(5000);
  for (let i = 0; i < 4; i++) { try { await p.waitForFunction(() => window.Clerk && window.Clerk.loaded, { timeout: 20000 }); break; } catch (e) { await p.waitForTimeout(3000); } }
  console.log('login:', await p.evaluate(async t => {
    const r = await window.Clerk.client.signIn.create({ strategy: 'ticket', ticket: t });
    if (r.status === 'complete') { await window.Clerk.setActive({ session: r.createdSessionId }); return 'complete'; }
    return r.status;
  }, process.env.TICKET));
  await p.waitForTimeout(1500);
  await safe('https://app.acuarius.app/');
  await p.waitForTimeout(9000);
  try { const t = p.locator('text=omitir tour'); if (await t.isVisible({ timeout: 3000 })) await t.click(); } catch (e) {}
  await p.waitForTimeout(1500);
  await p.context().storageState({ path: 'state.json' });
  await b.close();
})();

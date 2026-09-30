// El contador del agente sobrevive a un corte de red: node pruebas/cupo-agente-reintento.mjs
//
// El 29-09-2026 llegó un correo de error «cupo del agente: Failed to fetch»:
// dos cuentas en el mismo minuto de cortes de red contra Vercel. Un corte de
// un segundo no debería avisar a nadie. Se ejecuta la función real.

import { readFileSync } from 'node:fs';
let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra ? ' → ' + extra : '')); if (!c) mal++; };
const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const cuerpo = (firma) => {
  const i = js.indexOf(firma);
  let prof = 0, j = i + firma.length - 1;
  for (; j < js.length; j++) { if (js[j] === '{') prof++; else if (js[j] === '}' && --prof === 0) break; }
  return js.slice(i, j + 1);
};
async function correr(fallos) {
  let llamadas = 0; const errores = [];
  const caja = { innerHTML: '' };
  const f = new Function('document', 'fetchAuth', 'errRegistrar', 'setTimeout', 'userPlan', 'esc', 'fmtNum', 'icn', 'showView', 'navGo',
    cuerpo('async function agCupoPintar() {') + '; return agCupoPintar;')(
    { getElementById: () => caja },
    async () => { llamadas++; if (llamadas <= fallos) throw new TypeError('Failed to fetch');
      return { ok: true, status: 200, json: async () => ({ plan: 'pro', cupo: 500, usados: 12, restante: 488, porcentaje: 2, agotado: false }) }; },
    (m) => errores.push(m), (fn) => fn(), 'pro', (x) => String(x), (n) => String(n), () => '', () => {}, () => {});
  await f().catch(e => errores.push('LANZÓ ' + e.message));
  return { llamadas, errores, html: caja.innerHTML };
}
const uno = await correr(1);
ok(uno.llamadas === 2 && uno.errores.length === 0, 'un corte suelto se reintenta y no manda aviso', JSON.stringify(uno.errores));
ok(!/No se pudo consultar/.test(uno.html), 'y el contador se pinta', uno.html.slice(0, 120));
const dos = await correr(2);
ok(dos.llamadas === 2 && dos.errores.length === 1 && /No se pudo consultar/.test(dos.html), 'si falla dos veces, se dice en pantalla y se avisa — una sola vez', JSON.stringify(dos));
const bien = await correr(0);
ok(bien.llamadas === 1 && !bien.errores.length, 'con red, una sola petición');
console.log(mal ? `\n  ${mal} fallo(s)\n` : '\n  Todo en verde\n');
process.exit(mal ? 1 : 0);

// Comisiones de Partners: node pruebas/partners.mjs
//
// Lo que no puede fallar sin que nadie se entere: cuánto se le paga a un
// Partner. Un error aquí es plata de más o de menos, todos los meses.

import { comisionDe, mensualDe, armarLiquidacion, estadoCuenta, slugDesde } from '../api/_partners.js';
import { validarDatos } from '../api/partners.js';

let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); if (!c) mal++; };

console.log('\nComisión de un cobro');
{
  const c = comisionDe({ tipo: 'cobro', monto: 39, moneda: 'USD' }, 20, 1);
  ok(c.base_usd === 39 && c.comision_usd === 7.8, 'Pro mensual de 39 USD al 20 % = 7,80', c);
  const a = comisionDe({ tipo: 'cobro', monto: 1188, moneda: 'USD' }, 20, 1);
  ok(a.comision_usd === 237.6, 'Agency anual de 1.188 USD = 237,60 (se comisiona el año entero al cobrarse)', a);
  const cop = comisionDe({ tipo: 'cobro', monto: 160000, moneda: 'COP' }, 20, 4000);
  ok(cop.base_usd === 40 && cop.comision_usd === 8, 'en pesos se convierte a USD con la tasa: 160.000 COP a 4.000 = 40 USD → 8', cop);
  const rev = comisionDe({ tipo: 'reembolso', monto: 39, moneda: 'USD' }, 20, 1);
  ok(rev.comision_usd === -7.8 && rev.base_usd === -39, 'un reembolso descuenta lo mismo que generó', rev);
  const cc = comisionDe({ tipo: 'contracargo', monto: 99, moneda: 'USD' }, 20, 1);
  ok(cc.comision_usd === -19.8, 'un contracargo también descuenta', cc);
  let lanzo = false; try { comisionDe({ tipo: 'cobro', monto: 1, moneda: 'XYZ' }, 20, 0); } catch { lanzo = true; }
  ok(lanzo, 'sin tasa NO se inventa una comisión: lanza y el cron reintenta');
  ok(comisionDe({ tipo: 'cobro', monto: 33.33, moneda: 'USD' }, 20, 1).comision_usd === 6.67, 'redondea a centavos');
}

console.log('\nAporte mensual de una cuenta');
ok(mensualDe({ monto: 99, periodo: 'mensual' }, 1) === 99, 'mensual = lo cobrado');
ok(mensualDe({ monto: 1188, periodo: 'anual' }, 1) === 99, 'anual = lo cobrado / 12');
ok(mensualDe(null, 1) === 0, 'sin cobros, cero');

console.log('\nArmar una liquidación');
{
  const disp = [
    { id: 1, comision_usd: 7.8 }, { id: 2, comision_usd: 19.8 }, { id: 3, comision_usd: -7.8 },
  ];
  const a = armarLiquidacion(disp, [1, 2]);
  ok(a.dentro.length === 3 && a.total === 19.8, 'los descuentos entran siempre aunque no se elijan', a);
  const b = armarLiquidacion(disp, [1]);
  ok(b.total === 0, 'si los descuentos se comen lo elegido, el total no es positivo', b);
  const c = armarLiquidacion(disp, [1, 99]);
  ok(c.ajenas.length === 1 && c.ajenas[0] === '99', 'detecta ids que no son suyos o no están disponibles', c);
}

console.log('\nEstado de una cuenta referida');
ok(estadoCuenta({ plan: 'pro' }) === 'activa', 'Pro = activa');
ok(estadoCuenta({ plan: 'agency' }) === 'activa', 'Agency = activa');
ok(estadoCuenta({ plan: 'trial', trial_until: new Date(Date.now() + 864e5).toISOString() }) === 'prueba', 'prueba vigente');
ok(estadoCuenta({ plan: 'trial', trial_until: '2020-01-01' }) === 'desactivada', 'prueba vencida = desactivada');
ok(estadoCuenta({}) === 'desactivada', 'gratis = desactivada');

console.log('\nSlug del enlace');
ok(slugDesde('Seizo Group S.A.S.') === 'seizo-group-s-a-s', 'nombre comercial a slug', slugDesde('Seizo Group S.A.S.'));
ok(slugDesde('Ñandú Marketing') === 'nandu-marketing', 'quita tildes y eñes', slugDesde('Ñandú Marketing'));

console.log('\nPostulación');
ok(validarDatos({ correo: 'a@b.co' }).error, 'sin nombre comercial no se acepta');
ok(validarDatos({ nombre_comercial: 'X', correo: 'no-es-correo' }).error, 'correo inválido no se acepta');
{
  const v = validarDatos({ nombre_comercial: '  Seizo  ', correo: 'CEO@Seizo.com', sitio_web: 'seizo.com', paises: 'Colombia, México,, ' });
  ok(v.datos.nombre_comercial === 'Seizo' && v.datos.correo === 'ceo@seizo.com', 'limpia espacios y pasa el correo a minúsculas', v.datos);
  ok(v.datos.sitio_web === 'https://seizo.com', 'añade https:// al sitio', v.datos.sitio_web);
  ok(JSON.stringify(v.datos.paises) === '["Colombia","México"]', 'separa la lista por comas y quita vacíos', v.datos.paises);
}

console.log(mal ? `\n${mal} fallo(s)` : '\nTodo en verde');
process.exit(mal ? 1 : 0);

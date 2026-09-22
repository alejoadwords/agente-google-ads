// Que un movimiento que NO se guarda se deshaga y se diga, en vez de quedarse
// en pantalla mintiendo hasta que alguien recargue.
import fs from 'fs';
const src = fs.readFileSync('/Users/mac/Documents/Claude/Acuarius/public/app.js','utf8');
let mal=0; const ok=(c,m)=>{console.log((c?'  ✓ ':'  ✗ ')+m); if(!c)mal++;};

// se extrae el cuerpo del manejador de soltar y se ejecuta con dobles
const i = src.indexOf("el.addEventListener('drop'");
let d=0, j=src.indexOf('{', src.indexOf('async e =>', i));
for (let k=j;k<src.length;k++){ if(src[k]==='{')d++; else if(src[k]==='}'){d--; if(!d){j=k;break;}} }
const cuerpo = src.slice(src.indexOf('{', src.indexOf('async e =>', i))+1, j);

async function correr({ ok: respOk, status = 403, error = 'Este lead está asignado a otra persona.' }) {
  const estado = { render: 0, avisos: [], puts: 0 };
  const lead = { id: 'L1', stage: 'nuevo' };
  const ctx = {
    crmLeads: [lead],
    crmRenderKanban: () => estado.render++,
    crmIsWonStage: () => false, crmIsLostStage: () => false,
    crmStages: [{ key: 'contactado', label: 'Contactado' }],
    citaAbrir: () => false,
    showToast: (m) => estado.avisos.push(m),
    el: { classList: { remove(){}, add(){} } },   // el contenedor de la columna
    motivoDelFallo: async (r) => new Error(error),
    fetchAuth: async (url, o) => {
      if (url.includes('/api/leads')) { estado.puts++; return { ok: respOk, status }; }
      return { ok: true };
    },
  };
  const f = new Function(...Object.keys(ctx), 'stageKey', 'e', 'return (async () => {' + cuerpo + '})();');
  await f(...Object.values(ctx), 'contactado', { preventDefault(){}, dataTransfer:{ getData: () => 'L1' } });
  return { estado, lead };
}

const bien = await correr({ ok: true });
ok(bien.lead.stage === 'contactado', 'si se guarda, la tarjeta se queda en la columna nueva');
ok(bien.estado.avisos.length === 0, 'y no molesta con avisos');

const falla = await correr({ ok: false });
ok(falla.lead.stage === 'nuevo', 'si NO se guarda, la tarjeta vuelve a su columna (antes se quedaba movida)');
ok(falla.estado.avisos.length === 1, 'y se avisa en pantalla · ' + JSON.stringify(falla.estado.avisos[0]));
ok(/asignado a otra persona/.test(falla.estado.avisos[0] || ''), 'con el motivo del servidor, no un «error» genérico');
ok(falla.estado.render >= 2, 'y se repinta para que se vea volver · repintados: ' + falla.estado.render);
process.exit(mal?1:0);

import fs from 'fs';
for (const l of fs.readFileSync(process.argv[2]+'/.env','utf8').split('\n')) { const i=l.indexOf('='); if(i>0) process.env[l.slice(0,i)]=l.slice(i+1); }
const SB=process.env.SUPABASE_URL, K=process.env.SUPABASE_SERVICE_KEY;
const H={apikey:K,Authorization:'Bearer '+K};

// Se extrae la función ENTERA contando llaves y se ejecuta de verdad: probar
// un trozo recortado a ojo fue lo que reventó el primer intento.
const src = f => fs.readFileSync('/Users/mac/Documents/Claude/Acuarius/'+f,'utf8');
function sacarFuncion(fichero, firma) {
  const s = src(fichero), i = s.indexOf(firma);
  if (i < 0) throw new Error('no encuentro ' + firma + ' en ' + fichero);
  let d = 0, j = s.indexOf('{', i);
  for (let k = j; k < s.length; k++) {
    if (s[k] === '{') d++;
    else if (s[k] === '}') { d--; if (d === 0) { j = k; break; } }
  }
  // La función usa constantes del módulo (SIN_ASESOR). Se sacan del MISMO
  // fichero en vez de repetirlas aquí: si mañana cambia el texto de reserva,
  // la prueba lo sigue sola en lugar de mentir.
  const consts = (s.match(/^const [A-Z_]+ = .*;$/gm) || []).join('\n');
  return eval('(() => { ' + consts + '\n return (' + s.slice(i, j + 1) + '); })()');
}
const renderCampanas = sacarFuncion('api/cron-campaigns.js', 'function renderVars(text, lead) {');
const renderAutos    = sacarFuncion('api/cron-automations.js', 'function renderVars(text, lead) {');

// un lead REAL con asesor asignado
const lead = (await fetch(`${SB}/rest/v1/leads?assigned_name=not.is.null&select=*&limit=1`,{headers:H}).then(r=>r.json()))[0];
let mal=0; const ok=(c,m)=>{console.log((c?'  ✓ ':'  ✗ ')+m); if(!c)mal++;};

console.log('  lead de prueba:', lead.name, '· asesor:', lead.assigned_name, '\n');
const plantilla = 'Hola {{nombre}}, te atiende {{asesor}} de {{empresa}}.';
const vc = renderCampanas(plantilla, lead), va = renderAutos(plantilla, lead);
const limpio = String(lead.assigned_name).replace(/\s+/g, ' ').trim();
ok(vc.includes(limpio), 'campañas → ' + JSON.stringify(vc));
ok(va.includes(limpio), 'automatizaciones → ' + JSON.stringify(va));
ok(!/[\t\n]/.test(vc), 'el tabulador del nombre guardado NO llega al correo');
ok(!vc.includes('{{asesor}}'), 'no queda la variable literal en el texto');

// un lead SIN asesor: no revienta y no deja la llave a la vista
const sin = { name:'X', assigned_name:null };
const r = renderCampanas('Te atiende {{asesor}}.', sin);
ok(r === 'Te atiende nuestro equipo.', 'sin asesor cae el texto de reserva → ' + JSON.stringify(r));
ok(renderAutos('Te atiende {{asesor}}.', sin) === 'Te atiende nuestro equipo.', 'y en automatizaciones igual');
ok(renderCampanas('Hola {{nombre}}, de {{empresa}}.', {name:'X'}) === 'Hola X, de .',
   'las DEMÁS variables siguen quedando vacías: la reserva es solo para asesor');

// la plantilla de WhatsApp: Meta rechaza vacíos, así que debe SALTAR el lead
const wa = src('api/cron-campaigns.js');
ok(/asesor: String\(lead\.assigned_name.*\|\| SIN_ASESOR/.test(wa), 'WhatsApp: el parámetro asesor lleva reserva');
ok(/if \(!texto\) return \{ falta: campo \}/.test(wa), 'WhatsApp: los demás parámetros vacíos siguen saltando el lead');

// las listas del navegador
const app = src('public/app.js');
ok(/\{ v: 'asesor',/.test(app) && /nuestro equipo/.test(app), 'navegador: está en CAMPO_VARIABLES y avisa de la reserva');
ok(/\['asesor', 'Asesor asignado \(o «nuestro equipo»\)'\]/.test(app), 'navegador: está en CMP_CAMPOS_WA');
ok(/asesor: 'Carlos Asesor'/.test(app), 'navegador: la previsualización de WhatsApp lo muestra');

// el validador no debe marcarlo como desconocido
const m = app.match(/const validas = CAMPO_VARIABLES\.map\(x => x\.v\);/);
ok(!!m, 'el validador de variables sale de la MISMA lista, así que {{asesor}} ya es válida');
process.exit(mal?1:0);

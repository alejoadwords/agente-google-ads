// Que un fallo de red REAL se registre y una navegación no.
import fs from 'fs';
const src = fs.readFileSync('/Users/mac/Documents/Claude/Acuarius/public/app.js','utf8');
let mal=0; const ok=(c,m)=>{console.log((c?'  ✓ ':'  ✗ ')+m); if(!c)mal++;};
const i = src.indexOf('  } catch (e) {\n    // La red se cayó');
const bloque = src.slice(i, src.indexOf('    throw e;\n  }', i));

function corre({ nombre, oculto, seVa, abortada }) {
  const registrados = [];
  const ctx = {
    e: { name: nombre, message: 'Failed to fetch' },
    opts: { signal: abortada ? { aborted: true } : undefined },
    document: { hidden: oculto },
    _paginaSeVa: seVa,
    url: '/api/lead-activities?id=1',
    errRegistrar: (m, d) => registrados.push(d),
  };
  const cuerpo = bloque.replace('  } catch (e) {', '');
  new Function(...Object.keys(ctx), cuerpo)(...Object.values(ctx));
  return registrados;
}
ok(corre({nombre:'TypeError'}).length === 1, 'un fallo de red de verdad SÍ se registra');
ok(corre({nombre:'AbortError'}).length === 0, 'un abort NO');
ok(corre({nombre:'TypeError', abortada:true}).length === 0, 'una petición cancelada a propósito tampoco');
ok(corre({nombre:'TypeError', oculto:true}).length === 0, 'con la pestaña oculta tampoco');
ok(corre({nombre:'TypeError', seVa:true}).length === 0, 'ni cuando la página se está cerrando');
process.exit(mal?1:0);

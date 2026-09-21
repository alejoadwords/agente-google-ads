const M = await import('/Users/mac/Documents/Claude/Acuarius/api/_nps.js');
let mal=0; const ok=(c,m)=>{console.log((c?'  ✓ ':'  ✗ ')+m); if(!c)mal++;};

const d = M.normalizarNps(null);
ok(d.pregunta.includes('recomiendes'), 'sin configuración salen los textos de siempre');
ok(d.preguntas.length === 0, 'y ninguna pregunta extra');
ok(d.color === '#1E2BCC', 'y el azul de Acuarius');

ok(M.normalizarNps({ color: 'red; background:url(x)' }).color === '#1E2BCC', 'un color que no es #rrggbb no entra al atributo style');
ok(M.normalizarNps({ color: '#ff8800' }).color === '#ff8800', 'uno válido sí');
ok(M.normalizarNps({ logoUrl: 'javascript:alert(1)' }).logoUrl === '', 'un logo javascript: se descarta');
ok(M.normalizarNps({ logoUrl: 'http://x.com/a.png' }).logoUrl === '', 'y http a secas también (la página va por https)');
ok(M.normalizarNps({ logoUrl: 'https://x.com/a.png' }).logoUrl === 'https://x.com/a.png', 'https sí');
ok(M.normalizarNps({ boton: '   ' }).boton === 'Enviar', 'un texto en blanco vuelve al de por defecto, no deja el botón mudo');

const c = M.normalizarNps({ preguntas: [
  { tipo: 'escala5', texto: '¿Cómo fue la atención?' },
  { tipo: 'inventado', texto: 'algo' },
  { tipo: 'texto', texto: '' },
  ...Array.from({length:12},(_,i)=>({tipo:'texto',texto:'p'+i})),
]});
ok(c.preguntas[0].tipo === 'escala5', 'la escala se acepta');
ok(c.preguntas[1].tipo === 'texto', 'un tipo inventado cae a texto');
ok(!c.preguntas.some(p => !p.texto), 'una pregunta sin enunciado se descarta');
ok(c.preguntas.length === 8, 'el tope son 8 preguntas · quedaron ' + c.preguntas.length);
ok(new Set(c.preguntas.map(p=>p.id)).size === c.preguntas.length, 'los ids no se repiten');

ok(M.pieSegunNota(d, 10) === d.piePromotor && M.pieSegunNota(d, 8) === d.pieNeutro && M.pieSegunNota(d, 3) === d.pieDetractor,
   'cada nota recibe su pregunta de seguimiento');
process.exit(mal?1:0);

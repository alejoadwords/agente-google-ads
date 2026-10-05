// ¿De qué red es un lead? (normPlataforma / esClicDeGoogle en api/_gclid.js)
// node pruebas/plataforma.mjs
//
// Certain etiqueta utm_source=adwords y otra cuenta llega con «ig» y «fb».
// Se comparaba con «Google»/«Meta» exacto y esos leads nunca se atribuían ni
// se reportaban (04-10-2026). La misma regla vive en SQL: plataforma_red().
process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';
const { normPlataforma, esClicDeGoogle, pendientes } = await import('../api/_gclid.js');
let mal = 0;
const ok = (c, t, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + t + (!c && x ? ' → ' + x : '')); if (!c) mal++; };
for (const [v, e] of [['adwords', 'Google'], ['Google Ads', 'Google'], ['google_ads', 'Google'], ['cpc', 'Google'], ['Google', 'Google'],
  ['ig', 'Meta'], ['fb', 'Meta'], ['Facebook', 'Meta'], ['instagram', 'Meta'], ['Meta orgánico', 'Meta orgánico'], ['tiktok', 'TikTok'], ['ciencuadras', 'ciencuadras'], ['', '']]) {
  ok(normPlataforma(v) === e, `«${v}» → «${e}»`, normPlataforma(v));
}
const cf = (x) => ({ 'Clic de anuncio': 'CjwKCAjw', ...x });
ok(esClicDeGoogle(cf({ Plataforma: 'adwords' })), 'gclid con utm_source=adwords es de Google (el caso de Certain)');
ok(esClicDeGoogle(cf({ Plataforma: 'facebook', 'Tipo de clic': 'gclid' })), 'el tipo de clic manda sobre la UTM');
ok(!esClicDeGoogle(cf({ Plataforma: 'Meta' })), 'un clic con plataforma Meta no es de Google');
ok(esClicDeGoogle({ 'Clic de anuncio': 'EAIaIQobChMI' }) && !esClicDeGoogle({ 'Clic de anuncio': 'IwAR3xyz' }), 'sin plataforma: decide el formato (un fbclid empieza por Iw)');
ok(!esClicDeGoogle({ Plataforma: 'Google' }), 'sin clic no hay nada que preguntarle a Google');
ok(pendientes([{ custom_fields: cf({ Plataforma: 'adwords' }) }]).length === 1, 'y ya entra en la cola de clics por resolver');
console.log(mal ? `\n${mal} fallo(s)\n` : '\nTodo en orden\n');
process.exit(mal ? 1 : 0);

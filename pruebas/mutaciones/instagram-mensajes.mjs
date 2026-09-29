// Mutaciones de pruebas/instagram-mensajes.mjs — node tools/mutar.mjs pruebas/mutaciones/instagram-mensajes.mjs

export const SUITE = 'pruebas/instagram-mensajes.mjs';
export const ARCHIVOS = { canales: 'api/channel-connections.js' };
const cambiar = (de, a) => (s) => s.replace(de, a);

export const MUTACIONES = [
  { nombre: 'no se comprueba que los mensajes se lean', archivo: 'canales',
    romper: cambiar("      if (prueba?.error) return jsonResp(errorMensajesInstagram(prueba.error), 400);", "") },
  { nombre: 'la comprobación también frena a Messenger', archivo: 'canales',
    romper: cambiar("    if (channel === 'instagram') {\n      const prueba", "    if (true) {\n      const prueba") },
  { nombre: 'el 230 no se reconoce como el permiso', archivo: 'canales',
    romper: cambiar("  if (code === 230 || /instagram_manage_messages/i.test(msg)) {", "  if (false) {") },
  { nombre: 'el interruptor de Instagram no se explica', archivo: 'canales',
    romper: cambiar("  if (/access to messages|allow access|connected tools|herramientas conectadas/i.test(msg) || code === 10) {", "  if (false) {") },
  { nombre: 'la lista de páginas vuelve a aceptar el token del navegador', archivo: 'canales',
    romper: cambiar("    const metaToken = await metaTokenDe(userId);\n    if (!metaToken) return jsonResp({ error: 'Conecta tu cuenta de Meta en Configuración → Integraciones → Meta Ads' }, 409);\n    const res = await fetch(\n      `https://graph.facebook.com/v19.0/me/accounts",
                    "    const metaToken = url.searchParams.get('token') || await metaTokenDe(userId);\n    if (!metaToken) return jsonResp({ error: 'Conecta tu cuenta de Meta en Configuración → Integraciones → Meta Ads' }, 409);\n    const res = await fetch(\n      `https://graph.facebook.com/v19.0/me/accounts") },
];

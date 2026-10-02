// api/ping.js — responde y nada más.
//
// Lo usa el navegador para saber si un «Failed to fetch» fue nuestro o de su
// conexión: si justo después tampoco llega aquí, era su internet (o recargó la
// página) y no se registra como error. Sin sesión, sin base de datos y sin
// caché, para que la respuesta diga solo una cosa: «el servidor está».

export const config = { runtime: 'edge' };

export default function handler() {
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

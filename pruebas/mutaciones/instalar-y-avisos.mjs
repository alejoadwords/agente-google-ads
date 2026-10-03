// Mutaciones de pruebas/instalar-y-avisos.mjs — node tools/mutar.mjs pruebas/mutaciones/instalar-y-avisos.mjs

export const SUITE = 'pruebas/instalar-y-avisos.mjs';
export const ARCHIVOS = { app: 'public/app.js' };
const cambiar = (de, a) => (s) => { if (!s.includes(de)) throw new Error('no está: ' + de); return s.replace(de, a); };

export const MUTACIONES = [
  { nombre: 'soporte suscribe su dispositivo', archivo: 'app', romper: cambiar("async function pushSuscribirSilencioso() {\n  if (enSoporte()) return false;", "async function pushSuscribirSilencioso() {") },
  { nombre: 'no suscribe tras el permiso', archivo: 'app', romper: cambiar("if (conAvisos) await pushSuscribirSilencioso();", "") },
  { nombre: 'con permiso vuelve a preguntar', archivo: 'app', romper: cambiar("if (pushSoportado() && Notification.permission === 'default') {", "if (pushSoportado()) {") },
  { nombre: 'pide avisos aunque rechace', archivo: 'app', romper: cambiar("    return;                                   // dijo que no: no se le pide nada más", "") },
  { nombre: 'duplica la suscripción', archivo: 'app', romper: cambiar("conAvisos = !!(await pushSuscripcionActual()) || await pushSuscribirSilencioso();", "conAvisos = await pushSuscribirSilencioso();") },
];

// Mutaciones del RNE — node tools/mutar.mjs pruebas/mutaciones/sms-rne.mjs
// Corre las dos suites: el módulo (sms-rne) y lo que hacen los motores (sms-motores).

export const SUITE = 'pruebas/sms-rne.mjs && node pruebas/sms-motores.mjs';
export const ARCHIVOS = { rne: 'api/_rne.js', sms: 'api/_sms.js', camp: 'api/cron-campaigns.js', auto: 'api/cron-automations.js' };
const cambiar = (de, a) => (s) => { if (!s.includes(de)) throw new Error('no está: ' + de); return s.replace(de, a); };

export const MUTACIONES = [
  { nombre: 'enviarSms no mira el RNE', archivo: 'sms', romper: cambiar("if (enRne && enRne.sms === false) return", "if (false) return") },
  { nombre: 'sin RNE se envía igual', archivo: 'sms', romper: cambiar("if (e.rneNoDisponible) return { estado: 'rne_no_disponible', detalle: e.message };", "if (e.rneNoDisponible) enRne = null; else") },
  { nombre: 'inscrito sin dato del SMS se toma como sí', archivo: 'rne', romper: cambiar("sms: op.sms === true", "sms: op.sms !== false") },
  { nombre: 'la caché vale para siempre', archivo: 'rne', romper: cambiar("if (corte > ahora) corte.setUTCDate(corte.getUTCDate() - 1);", "corte.setUTCFullYear(2000);") },
  { nombre: 'vigencia desde medianoche', archivo: 'rne', romper: cambiar("corte.setUTCHours(8, 0, 0, 0);", "corte.setUTCHours(5, 0, 0, 0);") },
  { nombre: 'simulado permitido con el módulo abierto', archivo: 'rne', romper: cambiar("if (process.env.SMS_ACTIVO === '1') throw", "if (false) throw") },
  { nombre: 'lo simulado va a la caché', archivo: 'rne', romper: cambiar("return resultado;\n  }\n\n  const cache", "return resultado.size ? (await fetch(`${SUPABASE_URL}/rest/v1/rne_consultas?on_conflict=telefono`, { method: 'POST', headers: sbH({ Prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify(diez.map(t => ({ telefono: t, inscrito: false, sms: true, consultado_at: new Date().toISOString() }))) }), resultado) : resultado;\n  }\n\n  const cache") },
  { nombre: 'respuesta rara = nadie inscrito', archivo: 'rne', romper: cambiar("if (!Array.isArray(lista)) throw noDisponible('El RNE devolvió una respuesta que no se entiende');", "if (!Array.isArray(lista)) return [];") },
  { nombre: 'gana siempre el token de Vercel', archivo: 'rne', romper: cambiar("return (datosToken(env).iat || 0) > (datosToken(guardado).iat || 0) ? env : guardado;", "return env;") },
  { nombre: 'renueva siempre', archivo: 'rne', romper: cambiar("if (quedan > RENOVAR_DIAS_ANTES) return", "if (false) return") },
  { nombre: 'guardar el token renovado falla en silencio', archivo: 'rne', romper: cambiar("if (!g.ok) throw new Error('La CRC renovó", "if (false) throw new Error('La CRC renovó") },
  { nombre: 'la campaña no pasa el Map', archivo: 'camp', romper: cambiar("campaignId: c.id, remitente, rne });", "campaignId: c.id, remitente });") },
  // «La campaña sigue sin RNE» no está: es equivalente. Aunque el motor no
  // parara, enviarSms vuelve a consultar por cada SMS y lo frena igual.
  { nombre: 'el aviso no se borra', archivo: 'camp', romper: cambiar("          avisoSms = null;\n", "") },
  { nombre: 'la automatización falla en vez de esperar', archivo: 'auto', romper: cambiar("if (r.estado === 'rne_no_disponible') return { result: 'reintentar'", "if (r.estado === 'rne_no_disponible') return { result: 'failed'") },
];

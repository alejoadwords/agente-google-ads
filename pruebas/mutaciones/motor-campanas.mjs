// Mutaciones de pruebas/motor-campanas.mjs — node tools/mutar.mjs pruebas/mutaciones/motor-campanas.mjs

export const SUITE = 'pruebas/motor-campanas.mjs';
export const ARCHIVOS = { cron: 'api/cron-campaigns.js' };
const cambiar = (de, a) => (s) => s.replace(de, a);

export const MUTACIONES = [
  { nombre: 'el lote no dice su cuenta', archivo: 'cron', romper: cambiar("    body: JSON.stringify(sobres),\n  }, usuario);", "    body: JSON.stringify(sobres),\n  });") },
  { nombre: 'se llama sin la cuenta', archivo: 'cron', romper: cambiar("enviarLote(tanda.map(s => s.payload), c.user_id);", "enviarLote(tanda.map(s => s.payload));") },
];

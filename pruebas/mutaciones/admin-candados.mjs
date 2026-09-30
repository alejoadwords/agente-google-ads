// Mutaciones de pruebas/admin-candados.mjs — node tools/mutar.mjs pruebas/mutaciones/admin-candados.mjs

export const SUITE = 'pruebas/admin-candados.mjs';
export const ARCHIVOS = { admin: 'api/admin.js' };
const cambiar = (de, a) => (s) => s.replace(de, a);

export const MUTACIONES = [
  { nombre: 'sin secreto configurado se deja pasar', archivo: 'admin', romper: cambiar("  if (!ADMIN_SECRET) return false;\n", '') },
  { nombre: 'el bloqueo depende solo de la variable', archivo: 'admin', romper: cambiar("  return Array.from(new Set([...ADMIN_BASE, ...deVariable]));", "  return deVariable;") },
];

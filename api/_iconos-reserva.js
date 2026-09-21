// api/_iconos-reserva.js — los iconos que puede llevar un servicio.
//
// Hasta ahora todos salían con unas tijeras. En una veterinaria, un consultorio
// o un estudio de fotos eso no es un detalle: es lo primero que se ve y dice
// que la herramienta no es para ti.
//
// Los trazos están duplicados en `public/reservar.html` A PROPÓSITO: esa página
// es autónoma, no carga app.js ni nada del panel, porque tiene que abrir rápido
// en el móvil de alguien que va por la calle. Lo que NO puede diferir son las
// CLAVES: si aquí se renombra una, el servicio que la tuviera se quedaría con
// el icono por defecto. Por eso la lista vive aquí y hay una prueba que compara
// las dos copias.
//
// Solo se importa desde funciones EDGE (ver CLAUDE.md).

export const ICONOS_RESERVA = {
  cita:      'Cita o reunión',
  tijeras:   'Peluquería o barbería',
  belleza:   'Estética o spa',
  salud:     'Consulta médica',
  mascota:   'Veterinaria o mascotas',
  camara:    'Fotografía o video',
  espacio:   'Alquiler de un espacio',
  asesoria:  'Asesoría o consultoría',
  clase:     'Clase o formación',
  taller:    'Taller o reparación',
  deporte:   'Entrenamiento o deporte',
  comida:    'Restaurante o catering',
};

export const ICONO_POR_DEFECTO = 'cita';

/** ¿Es una clave del catálogo? Cualquier otra cosa se cae al icono por defecto. */
export function iconoValido(k) {
  return Object.prototype.hasOwnProperty.call(ICONOS_RESERVA, String(k || ''));
}

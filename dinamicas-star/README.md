# Dinamicas Star — Landing para WordPress + Elementor

## Archivos

- `dinamicas-star-elementor.json` → **el template para importar en Elementor** (13 secciones, editable visualmente)
- `preview.html` → preview del diseño en HTML puro (solo referencia visual, no se sube a WordPress)

## Cómo importar en WordPress

1. En el admin de WordPress: **Plantillas → Plantillas guardadas** (menú de Elementor).
2. Botón **Importar plantillas** (arriba) → subir `dinamicas-star-elementor.json`.
3. Crear una página nueva → **Editar con Elementor**.
4. En el editor, click en el ícono de carpeta (Agregar plantilla) → pestaña **Mis plantillas** → **Insertar** "Dinamicas Star — Landing".
5. La página ya viene configurada con lienzo Elementor (sin header/footer del theme) y fondo oscuro.

> Funciona con **Elementor Free** — no usa ningún widget Pro.

## Qué tenés que reemplazar después de importar

1. **Imagen del hero** (columna derecha de la primera sección): es un placeholder gris-verde. Subí el arte de "Dinamicas Star" (el gráfico con la estrella, balotas y trébol) a la Biblioteca de medios y reemplazala. Tamaño recomendado: ~760×720 px, PNG con fondo transparente u oscuro.
2. **Video** (sección Confianza): el widget de video tiene una URL de YouTube de ejemplo. Poné la URL del video real del vocero.
3. **Countdown**: es 100% automático — cuenta hasta las **10:00 PM hora Colombia de cada día** y al pasar esa hora se reinicia solo apuntando al día siguiente. La fecha ("SORTEO 24 DE JULIO · 10 PM") también se actualiza sola. Si algún día cambia la hora del sorteo, editá el atributo `data-hour="22"` en el widget HTML (formato 24 h, hora de Bogotá).
4. **Links de los botones**: todos los botones "PARTICIPAR AHORA" y "COMPRAR" apuntan a `#`. Poné la URL real de compra/registro de cada paquete.
5. **Instagram**: el ícono de Instagram apunta a `#`; el de WhatsApp ya apunta a `wa.me/573011641378`.
6. **Logo**: el logo es texto ("DINAMICAS STAR"). Si querés el logo circular con la estrella, reemplazá ese widget de título por un widget de imagen.

## Tipografías

Usa **Anton** (títulos display) y **Roboto** (textos), ambas de Google Fonts — Elementor las carga solo, no hay que instalar nada.

## Colores del diseño

| Uso | Color |
|---|---|
| Fondo | `#050805` |
| Tarjetas | `#0C110B` con borde `rgba(147,226,35,0.25)` |
| Verde neón (acentos, botones) | `#93E223` |
| Verde oscuro (gradiente tarjetas de paquetes) | `#54B70C` |
| Texto secundario | `#C9CFC6` |

## Nota responsive

Las secciones de 4 y 5 columnas (stats, pasos, paquetes) se apilan automáticamente en móvil con el comportamiento estándar de Elementor. Después de importar, revisá la vista móvil en el editor (ícono de responsive abajo a la izquierda) y ajustá tamaños de fuente del H1 si hace falta (ya trae 42px para móvil).

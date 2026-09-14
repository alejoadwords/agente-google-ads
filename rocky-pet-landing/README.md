# Rocky Pet Co — Landing para WordPress + Elementor

Réplica del mockup en template nativo de Elementor (editable visualmente).

## Archivos

- `rocky-pet-elementor.json` → **el template para importar en Elementor** (16 secciones)
- `preview.html` → referencia visual de cómo debe quedar (no se sube a WordPress)

## Cómo importar

1. WordPress admin → **Plantillas → Plantillas guardadas → Importar plantillas** → subir `rocky-pet-elementor.json`.
2. Página nueva → **Editar con Elementor** → ícono de carpeta → **Mis plantillas** → Insertar "Rocky Pet Co — Landing".
3. Ya viene con lienzo Elementor (sin header/footer del theme) y fondo crema.

> Funciona con **Elementor Free** — no usa widgets Pro.

## Qué reemplazar después de importar

1. **Todas las imágenes son placeholders** con las medidas correctas escritas encima:
   - Hero: 760×560 (la foto del perro con corona del mockup)
   - Productos: 400×400 cada uno (6 fotos)
   - Tiras de categorías: 700×90 — o mejor: borrá esa imagen y poné un widget **Galería básica** con las miniaturas reales de cada categoría
   - Sección familia: 500×620 y 440×260
2. **WhatsApp**: todos los botones "Lo quiero" y el CTA verde apuntan a `wa.me/5215512345678` (el 55 1234 5678 del mockup es de relleno). Buscá `5215512345678` en el editor y reemplazalo por el número real con formato `521` + 10 dígitos (México).
3. **Logo**: es texto (👑 ROCKY PET CO). Si tenés el logo real en imagen, reemplazá ese widget de título por un widget de imagen en header y footer.
4. **Redes sociales** del footer apuntan a `#`.
5. **Links del footer** (términos, privacidad, envíos) apuntan a `#`.

## Diseño

- Fondo `#F6EEE2` (crema), tarjetas `#FBF6EC` con borde `#EADFC9`
- Café oscuro `#33220F` (textos/botones), barra superior y footer `#2E1D0E`
- Dorado `#B98A3B` / `#D9AE62`, estrellas `#E8A33D`, WhatsApp `#25D366`
- Tipografías: **Playfair Display** (títulos display) + **Inter** (textos), ambas las carga Elementor solo

## Nota

Los productos, precios y conteos de reseñas son los del mockup — ajustalos a los datos
reales de la tienda. La fila de 6 productos se apila de a 2 en móvil (comportamiento
estándar de Elementor).

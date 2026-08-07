# Landing Google Ads — BlindaElec / Puertas de Seguridad Bogotá

Landing de conversión enfocada 100% en **llamadas y contactos por WhatsApp**, para reemplazar
https://blindaelec.com/puertas-de-seguridad/ como página de destino de la campaña.

## Archivo

- `index.html` — landing completa, autocontenida (un solo archivo, sin dependencias externas: CSS y SVG inline, fuentes del sistema). Las fotos se cargan desde el propio dominio blindaelec.com (wp-content), así que al subirla al mismo hosting cargan de inmediato.

## Cómo subirla a WordPress (2 opciones)

### Opción A — Archivo estático (recomendada: máxima velocidad)
1. Entra al hosting (cPanel / administrador de archivos / FTP).
2. Crea la carpeta `public_html/ads-puertas/` (o el nombre que prefieras).
3. Sube `index.html` dentro.
4. La landing queda en `https://blindaelec.com/ads-puertas/` → usa esa URL como página de destino en Google Ads.

Ventajas: carga en milisegundos (mejor nivel de calidad en Ads), sin interferencia del theme ni de plugins.

### Opción B — Dentro de WordPress con Gutenverse
1. Crea una página nueva en WordPress (ej. "Puertas de Seguridad — Ads").
2. En los ajustes de la página elige la plantilla **en blanco / canvas** del theme (sin header ni footer).
3. Agrega un bloque **HTML personalizado** y pega TODO el contenido de `index.html`.
4. Publica y usa esa URL en la campaña.

Nota: en la opción B el CSS del theme puede interferir levemente; si ves algo raro, usa la opción A.

## Medición de conversiones (importante)

Los clicks en llamar y WhatsApp empujan eventos al `dataLayer`:
- `click_llamada` — cualquier botón/enlace de llamada
- `click_whatsapp` — cualquier botón/enlace de WhatsApp

En Google Tag Manager:
1. Crea 2 activadores de tipo "Evento personalizado" con esos nombres.
2. Conéctalos a 2 conversiones de Google Ads ("Llamada desde landing" y "Contacto WhatsApp").
3. Marca ambas como conversiones principales de la campaña.

Si no usan GTM en blindaelec.com, hay que agregar el snippet de GTM (o gtag) en el `<head>` del archivo — está comentado dónde.

## Decisiones de conversión aplicadas

- **Sin menú de navegación** — el único camino es llamar o escribir (la página actual fugaba tráfico a Home/Blog/etc).
- **Doble CTA arriba del pliegue** (WhatsApp verde + llamada naranja) visible sin scroll en móvil.
- **Barra fija inferior en móvil** con Llamar + WhatsApp siempre visibles.
- **Diferenciales reales** extraídos de la ficha técnica: acero certificado Indumil, bisagras bóveda bancaria, marco con 6 uñas ancladas en concreto, cerradura con 6 llaves.
- **Galería con 8 fotos reales** de la página actual; cada foto abre WhatsApp con mensaje precargado.
- **FAQ que maneja la objeción de precio** sin dar cifras: lleva a la visita gratuita.
- **Cobertura por zonas** (Rosales, Chicó, Usaquén…) — relevancia local para el nivel de calidad.
- `noindex` para no competir en SEO con la página orgánica existente.

## Recomendaciones para la campaña

- Activa **extensiones de llamada** y usa la misma URL limpia como destino.
- Si puedes, crea una variante de la campaña solo-llamadas (Call Ads) en horario comercial.
- El mensaje precargado de WhatsApp identifica que el lead viene de la landing.

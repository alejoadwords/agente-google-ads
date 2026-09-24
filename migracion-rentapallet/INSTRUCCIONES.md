# Migración rentapallet.com → colestibassa.com

`rentapallet-a-colestibassa.xml` crea en colestibassa.com las **25 páginas y la entrada del blog**
de rentapallet.com, reconstruidas con el diseño de colestibassa (tema Indostio + Elementor):
banner del tema con título y migas, subtítulos rojos «// …», títulos Manrope, botones rojos,
tarjetas blancas y acordeones. Trae además **52 imágenes y videos**, que el importador descarga
a la biblioteca de medios de colestibassa.

## Cómo importarlo (3 minutos)

1. Entra a `colestibassa.com/wp-admin` → **Herramientas → Importar**.
2. En «WordPress», pulsa **Instalar ahora** y luego **Ejecutar el importador**.
3. Sube `rentapallet-a-colestibassa.xml`.
4. En «Asignar autores», elige tu usuario (**dev**) en el desplegable.
5. **Marca la casilla «Descargar e importar archivos adjuntos».** Sin esto las páginas salen sin fotos.
6. Pulsa **Enviar** y espera: descarga ~30 MB (hay dos videos), puede tardar un par de minutos.

Si alguna página se ve sin estilos al abrirla: **Elementor → Herramientas → Regenerar archivos y datos**.

## Qué se crea

Todas se publican con **la misma URL que tenían en rentapallet** (solo cambia el dominio),
así después es fácil poner redirecciones 301 si se apaga el sitio viejo. Nada existente en
colestibassa se modifica: la portada actual sigue siendo la portada.

| URL | Notas |
|---|---|
| /inicio/ | La portada de rentapallet como página aparte (no reemplaza la portada de colestibassa) |
| /acerca-de-renta-pallet/, /nuestra-historia/, /rap/ | /rap/ estaba vacía en rentapallet: ahora es un índice con 4 tarjetas a las páginas de RAP |
| /pooling/, /sistema/, /apl/, /caracteristicas/, /sostenibilidad/ | Servicios |
| /como-pedir/, /contacto-2/ (título «Atención al usuario»), /faq/ | Las preguntas frecuentes quedaron en acordeón |
| /noticias/, /media/ | |
| /bolsa-de-empleo/, /current-jobs/ | Vacantes en acordeón (ver pendientes) |
| /terminos-y-condiciones/, /politica-de-uso/, /politica-de-cookie/ | |
| /landing-page/ | Con encabezado y pie de colestibassa, sin banner de título |
| /tarjeta-de-presentacion…/ (5) | Tarjetas digitales, sin encabezado ni pie (como las originales) |
| /quieres-mejorar-el-almacenamiento-de-tus-productos/ | Entrada del blog, en la categoría nueva «Noticias RAP» |

## Pendientes que quedan de tu lado

- **Menú**: ninguna página nueva está en el menú (como pediste).
- **Vacantes**: rentapallet usa un plugin de bolsa de empleo que colestibassa no tiene. Las
  vacantes quedaron como texto, y «Aplicar a esta vacante» lleva al formulario en rentapallet.com.
- **«Guardar contacto» de las tarjetas**: los archivos .vcf siguen alojados en rentapallet.com.
  Si algún día se apaga ese sitio, hay que subirlos a colestibassa y cambiar el enlace del botón.
- **/tarjeta-de-presentacion/** es la plantilla con datos de ejemplo («Maria Alfaro», +506 8888-8888),
  igual que en rentapallet.

## Correcciones que hice al contenido original

- En Nuestra historia (año 2020) había publicada una nota interna de maquetación:
  «(Colocar el logo de AP&L y una imagen de fondo del mapa de la región caribe)». La quité.
- En Características, la última ficha decía «Capacidad de carga en rangueo» pero el dato es el
  color de la tarima; la etiqueta quedó como «Color».
- En las tarjetas digitales, los correos enlazaban a `http://correo@…` (no abrían el correo);
  ahora son enlaces `mailto:`.
- Los títulos en MAYÚSCULAS pasaron a tipo oración, que es el estilo de colestibassa.

## Verificar después de importar

```bash
bash verificar.sh
```

Revisa que cada una de las 25 páginas y la entrada respondan, tengan contenido de Elementor
y que sus imágenes carguen desde colestibassa.com.

La carpeta `vista-previa/` tiene una captura de cómo debería verse cada página.

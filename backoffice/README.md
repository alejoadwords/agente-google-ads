# backoffice/

**Aquí NO está el panel de administración.** El panel que se ve en
`admin.acuarius.app` vive en otro repositorio:

    github.com/alejoadwords/acuarius-admin   (proyecto de Vercel: acuarius-admin)

Esta carpeta llegó a tener una copia de ese panel (`index.html`) y otra de
`api/admin.js`. Las dos se quedaron atrás, y el 18-08-2026 costaron una sección
entera de tickets escrita sobre la copia muerta: se veía correcta, pasaba las
comprobaciones y no llegaba a producción, porque este repositorio no la
despliega. Se borraron por eso.

## Dónde está cada cosa

- **La interfaz del panel** → repositorio `acuarius-admin`, archivo `index.html`.
- **Su API** → aquí, en `api/admin.js`. El panel la consume contra
  `https://app.acuarius.app/api/admin?action=...` con la cabecera
  `x-admin-secret`. Añadir una función al panel casi siempre significa tocar
  los dos repositorios.

## Lo que sí sigue vivo en esta carpeta

- `supabase-schema.sql` — referencia del esquema. No se ejecuta solo; las
  migraciones que se corren de verdad están en `sql/`.
- `migrations/add_video_credits.sql` — migración antigua que no se movió a `sql/`.
- `generate_pdf.py` — genera el PDF del pack de videos de Hotmart. No tiene
  relación con el panel.

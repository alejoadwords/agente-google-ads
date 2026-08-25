# Este NO es el landing que se despliega

acuarius.app se sirve desde el proyecto Vercel `acuarius-landing`, que está
enganchado a **otro repositorio**: `alejoadwords/acuarius-landing` (rama `main`,
`index.html` en la raíz). Este repo no lo despliega.

Lo que hay aquí es una copia de trabajo. El 25-08-2026 llevaba semanas
desfasada: producción tenía calculadora de precios, la franja de benchmarks,
14 días de prueba y otros límites de plan, y esta copia seguía con la versión
vieja más una sección de creativos que nunca llegó a publicarse (sus imágenes
no existen en el repo del landing).

**Antes de tocar este archivo**, baja el que está vivo y trabaja sobre él:

    gh api repos/alejoadwords/acuarius-landing/contents/index.html --jq '.content' | base64 -d > index.html

**Después de editarlo**, súbelo al repo de verdad — si solo haces commit aquí,
el cambio no se ve en ningún lado:

    gh api repos/alejoadwords/acuarius-landing/contents/index.html -X PUT \
      -f message="..." -f sha="<sha actual>" \
      -f content="$(base64 -i index.html)"

Y comprueba que producción sirve el cambio, no que el despliegue diga READY:

    curl -s https://acuarius.app | grep "<texto que agregaste>"

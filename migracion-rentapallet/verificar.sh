#!/bin/bash
# Revisa, después de importar, que cada página nueva de colestibassa.com exista,
# se haya dibujado con Elementor y que sus imágenes carguen desde colestibassa.
cd "$(dirname "$0")"
SITE=https://colestibassa.com
ok=0; mal=0
while read slug; do
  html=$(curl -sL -A "Mozilla/5.0" "$SITE/$slug/?nocache=$RANDOM")
  code=$(curl -s -o /dev/null -L -A "Mozilla/5.0" -w "%{http_code}" "$SITE/$slug/")
  if [ "$code" != "200" ]; then echo "✗ $slug — responde $code"; mal=$((mal+1)); continue; fi
  if ! echo "$html" | grep -q 'elementor-element'; then echo "✗ $slug — la página existe pero sin contenido de Elementor"; mal=$((mal+1)); continue; fi
  rotas=0
  for img in $(echo "$html" | grep -oE 'https://colestibassa.com/wp-content/uploads/2026/09/[^"'"'"' )]+' | sort -u); do
    c=$(curl -s -o /dev/null -I -A "Mozilla/5.0" -w "%{http_code}" "$img"); [ "$c" = "200" ] || { rotas=$((rotas+1)); echo "   imagen rota: $img"; }
  done
  if [ "$rotas" -gt 0 ]; then echo "✗ $slug — $rotas imágenes rotas"; mal=$((mal+1)); else echo "✓ $slug"; ok=$((ok+1)); fi
done < urls.txt
echo "---- $ok bien, $mal con problemas"

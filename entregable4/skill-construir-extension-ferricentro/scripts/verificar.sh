#!/usr/bin/env bash
# Verificación estática antes de construir/probar la extensión.
# Uso: verificar.sh [ruta_proyecto]
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROYECTO="${1:-${PROYECTO:-$PWD}}"
EXT="$PROYECTO/extension-ferricentro"
ERRORES=0

ok()   { printf '  OK    %s\n' "$1"; }
mal()  { printf '  FALLA %s\n' "$1"; ERRORES=$((ERRORES + 1)); }

echo "Proyecto: $PROYECTO"
echo "Skill:    $SKILL_DIR"

echo
echo "1) Archivos de la extensión"
for f in manifest.json popup.html popup.css popup.js extractor.js; do
  if [ -f "$EXT/$f" ]; then ok "$EXT/$f"; else mal "falta $EXT/$f"; fi
done
if [ -f "$EXT/extractor.js" ]; then
  grep -q 'extractProductsAll' "$EXT/extractor.js" && ok "paginación automática (extractProductsAll)" || mal "extractor.js no define extractProductsAll"
fi
if [ -f "$EXT/popup.js" ]; then
  grep -q 'buildInventoryFiles' "$EXT/popup.js" && ok "división de inventario (buildInventoryFiles)" || mal "popup.js no define buildInventoryFiles"
  for n in catalogo_proveedor.csv actualizacion_pos.csv excepciones.csv; do
    grep -q "$n" "$EXT/popup.js" && ok "salida $n" || mal "popup.js no genera $n"
  done
fi

echo
echo "2) Contrato Manifest V3"
if [ -f "$EXT/manifest.json" ]; then
  python3 - "$EXT/manifest.json" <<'PY' || ERRORES=$((ERRORES + 1))
import json, sys
m = json.load(open(sys.argv[1], encoding='utf-8'))
def check(cond, msg):
    if not cond:
        print(f'  FALLA {msg}')
        sys.exit(1)
check(m.get('manifest_version') == 3, 'manifest_version debe ser 3')
check(m.get('action', {}).get('default_popup') == 'popup.html', 'action.default_popup debe ser popup.html')
perm = set(m.get('permissions', []))
check({'activeTab', 'scripting', 'downloads'} <= perm, f'faltan permisos mínimos: {perm}')
hosts = ' '.join(m.get('host_permissions', []))
check('ferricentro.com' in hosts, 'host_permissions debe limitarse a ferricentro.com')
check('<all_urls>' not in hosts, 'host_permissions no debe usar <all_urls>')
check(m.get('content_scripts', []) == [], 'no debe haber content scripts automáticos')
print('  OK    manifest MV3, permisos mínimos y dominio autorizado')
PY
else
  mal "no se puede validar manifest.json"
fi

echo
echo "3) Lanzador local (CDP + chrome.scripting + chrome.downloads)"
for f in abrir_ferricentro.sh cargar_extension.py usar_extension.py; do
  if [ -f "$PROYECTO/$f" ]; then ok "$PROYECTO/$f"; else mal "falta $PROYECTO/$f"; fi
done
if [ -f "$PROYECTO/abrir_ferricentro.sh" ] && [ ! -x "$PROYECTO/abrir_ferricentro.sh" ]; then
  mal "abrir_ferricentro.sh no es ejecutable (chmod +x)"
fi

echo
echo "4) Selector de categorías"
if [ -f "$SKILL_DIR/scripts/categorias.py" ]; then
  if python3 -m py_compile "$SKILL_DIR/scripts/categorias.py" 2>/dev/null; then
    ok "categorias.py (cualquier categoría pública)"
  else
    mal "categorias.py tiene errores de sintaxis"
  fi
else
  mal "falta $SKILL_DIR/scripts/categorias.py"
fi

echo
echo "5) Dependencias del entorno"
if command -v google-chrome >/dev/null 2>&1; then
  ok "google-chrome: $(command -v google-chrome)"
else
  mal "google-chrome no está en PATH"
fi
if python3 -c 'import websockets' 2>/dev/null; then
  ok "python3 + websockets"
else
  mal "falta el módulo python websockets"
fi
if command -v curl >/dev/null 2>&1; then ok "curl"; else mal "falta curl"; fi

echo
if [ "$ERRORES" -eq 0 ]; then
  echo "RESULTADO: listo para ejecutar los 7 pasos (verificar.sh OK)."
  exit 0
fi
echo "RESULTADO: $ERRORES problema(s). Corrige antes de ejecutar los 7 pasos." >&2
exit 1

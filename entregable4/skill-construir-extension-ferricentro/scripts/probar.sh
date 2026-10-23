#!/usr/bin/env bash
# Construye/carga la extensión con Chrome y ejecuta los 7 pasos.
# Uso:
#   probar.sh                       # menú de categorías (TTY) o Combos
#   probar.sh 12                    # categoría nº 12 del menú
#   probar.sh perforacion           # búsqueda por nombre/ruta
#   probar.sh /productos/...        # ruta de categoría
#   probar.sh https://ferricentro.com/...  # URL completa
#   probar.sh --listar              # lista categorías y sale
#   MODO=error probar.sh [url]      # espera error claro y CERO descargas
#
# Variables:
#   PROYECTO   carpeta de trabajo (default: $PWD)
#   REINICIAR  1 = cierra la sesión previa de Chrome antes de arrancar
#   MODO       ok | error
#   SELECCION  0 = no mostrar menú interactivo (usa Combos si no hay URL)
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROYECTO="${PROYECTO:-$PWD}"
MODO="${MODO:-ok}"
CATEGORIAS="$SKILL_DIR/scripts/categorias.py"

ok()  { printf '  OK    %s\n' "$1"; }
mal() { printf '  FALLA %s\n' "$1"; }

resolver_url() {
  local arg="$1"
  if [[ "$arg" =~ ^https?:// ]]; then
    printf '%s\n' "$arg"
  elif [[ "$arg" =~ ^[0-9]+$ ]]; then
    python3 "$CATEGORIAS" --url "$arg"
  elif [[ "$arg" == /* ]]; then
    printf 'https://ferricentro.com%s\n' "$arg"
  elif [[ "$arg" == */* ]]; then
    printf 'https://ferricentro.com/%s\n' "${arg#/}"
  else
    python3 "$CATEGORIAS" --buscar "$arg"
  fi
}

ARG="${1:-}"
if [ "$ARG" = "--listar" ] || [ "$ARG" = "listar" ]; then
  python3 "$CATEGORIAS" --listar
  exit 0
fi

if [ "$MODO" = "error" ]; then
  URL="${ARG:-https://ferricentro.com/checkout/cart}"
else
  if [ -z "$ARG" ] && [ "${SELECCION:-1}" != "0" ] && [ -t 0 ]; then
    echo "Categorías disponibles:"
    python3 "$CATEGORIAS" --listar || true
    read -rp "Selecciona un número (Enter = Combos): " OPC || OPC=""
    ARG="${OPC:-https://ferricentro.com/combos}"
  fi
  ARG="${ARG:-https://ferricentro.com/combos}"
  if ! URL="$(resolver_url "$ARG")"; then
    echo "ERROR: no se pudo resolver la categoría: $ARG" >&2
    echo "Usa un número de la lista, una ruta o una URL completa." >&2
    exit 2
  fi
  echo "Categoría seleccionada: $URL"
fi

echo "== 0. Preparar proyecto =="
echo "Proyecto: $PROYECTO"
mkdir -p "$PROYECTO"

if [ ! -d "$PROYECTO/extension-ferricentro" ]; then
  cp -r "$SKILL_DIR/plantilla" "$PROYECTO/extension-ferricentro"
  echo "  extensión creada desde la plantilla del skill"
fi
for f in abrir_ferricentro.sh cargar_extension.py usar_extension.py; do
  if [ ! -f "$PROYECTO/$f" ]; then
    cp "$SKILL_DIR/lanzador/$f" "$PROYECTO/$f"
    echo "  copiado $f desde el skill"
  fi
done
chmod +x "$PROYECTO/abrir_ferricentro.sh"

echo
echo "== 1-4. Verificación de estructura y entorno =="
PROYECTO="$PROYECTO" "$SKILL_DIR/scripts/verificar.sh" "$PROYECTO"

echo
echo "== 2-7. Abrir navegador, cargar extensión y ejecutar acción explícita =="
echo "URL: $URL  (modo: $MODO)"

set +e
SALIDA="$(cd "$PROYECTO" && REINICIAR="${REINICIAR:-0}" ./abrir_ferricentro.sh "$URL" 2>&1)"
RC=$?
set -e
printf '%s\n' "$SALIDA" | sed 's/^/  /'
echo "  (código de salida del lanzador: $RC)"

CATALOGO="$(printf '%s\n' "$SALIDA" | sed -n 's/^Catálogo guardado en: //p' | tail -1)"
CATALOGO="${CATALOGO% (*}"
POS="$(printf '%s\n' "$SALIDA" | sed -n 's/^Actualización POS guardada en: //p' | tail -1)"
POS="${POS% (*}"
EXC="$(printf '%s\n' "$SALIDA" | sed -n 's/^Excepciones guardadas en: //p' | tail -1)"
EXC="${EXC% (*}"

if [ "$MODO" = "error" ]; then
  if [ "$RC" -eq 0 ]; then
    mal "se esperaba error/clara negativa pero el lanzador terminó con éxito"
    exit 1
  fi
  if [ -n "$CATALOGO$POS$EXC" ]; then
    mal "se descargaron CSV cuando no correspondía: $CATALOGO $POS $EXC"
    exit 1
  fi
  ok "página no compatible: error claro y CERO descargas"
  echo
  echo "RESULTADO: prueba negativa correcta."
  exit 0
fi

if [ "$RC" -ne 0 ]; then
  mal "la extracción falló (rc=$RC)"
  exit 1
fi
for par in "catálogo:$CATALOGO" "POS:$POS" "excepciones:$EXC"; do
  nombre="${par%%:*}"
  ruta="${par#*:}"
  if [ -z "$ruta" ]; then
    mal "el lanzador no reportó la ruta de $nombre"
    exit 1
  fi
  if [ ! -f "$ruta" ]; then
    mal "el CSV de $nombre no existe: $ruta"
    exit 1
  fi
  ok "CSV de $nombre: $ruta"
done
python3 "$SKILL_DIR/scripts/validar_csv.py" "$CATALOGO" "$POS" "$EXC"

echo
echo "RESULTADO: 7 pasos completados correctamente."

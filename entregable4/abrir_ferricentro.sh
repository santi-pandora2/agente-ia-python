#!/usr/bin/env bash
# Abre Chrome con la extensión Ferricentro, la carga y EJECUTA la extracción
# (analiza la página y descarga el CSV), todo en una sola ejecución.
#
# Uso:    ./abrir_ferricentro.sh [URL]
#         ./abrir_ferricentro.sh https://ferricentro.com/combos
#         AUTO=0 ./abrir_ferricentro.sh          # solo abre, sin extraer
#         REINICIAR=1 ./abrir_ferricentro.sh     # cierra la sesión previa primero
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT="$DIR/extension-ferricentro"
PERFIL="${PERFIL_DIR:-$DIR/.perfil-chrome}"
URL="${1:-https://ferricentro.com/combos}"
AUTO="${AUTO:-1}"
REINICIAR="${REINICIAR:-0}"
PUERTO_ARCHIVO="$PERFIL/.puerto-cdp"
ID_ARCHIVO="$PERFIL/.ext-id"

if [ ! -f "$EXT/manifest.json" ]; then
  echo "ERROR: no se encontró la extensión en $EXT"
  exit 1
fi

esta_activo() { curl -sf "http://127.0.0.1:$1/json/version" >/dev/null 2>&1; }

# Estado del Chrome que ya usa este perfil (puerto / sinpuerto / vacío)
puerto_del_perfil() {
  python3 - "$PERFIL" <<'PY'
import os, sys
perfil = sys.argv[1].encode()
me = os.getpid()
en_uso = False
for pid in os.listdir('/proc'):
    if not pid.isdigit() or int(pid) == me:
        continue
    try:
        cmd = [c for c in open(f'/proc/{pid}/cmdline','rb').read().split(b'\0') if c]
    except OSError:
        continue
    if not cmd or b'chrome' not in cmd[0].lower():
        continue
    if not any(perfil in c for c in cmd):
        continue
    en_uso = True
    for c in b' '.join(cmd).split():
        if c.startswith(b'--remote-debugging-port='):
            print(c.split(b'=',1)[1].decode())
            sys.exit(0)
if en_uso:
    print('sinpuerto')
PY
}

# ¿Sesión previa con este perfil todavía abierta?
PUERTO=""
if [ "$REINICIAR" = "1" ] && [ -n "$(puerto_del_perfil)" ]; then
  echo "Cerrando sesión previa del perfil..."
  for _ in $(seq 1 15); do
    python3 - "$PERFIL" <<'PY'
import os, sys, signal
perfil = sys.argv[1]
me = os.getpid()
for pid in os.listdir('/proc'):
    if not pid.isdigit() or int(pid) == me:
        continue
    try:
        cmd = open(f'/proc/{pid}/cmdline', 'rb').read().split(b'\0')
    except OSError:
        continue
    if not cmd or b'chrome' not in cmd[0].lower():
        continue
    if any(perfil.encode() in c for c in cmd):
        try:
            os.kill(int(pid), signal.SIGKILL)
        except OSError:
            pass
PY
    [ -z "$(puerto_del_perfil)" ] && break
    sleep 1
  done
  if [ -n "$(puerto_del_perfil)" ]; then
    echo "ERROR: no se pudo cerrar la sesión previa del perfil."
    exit 1
  fi
fi

PUERTO="$(puerto_del_perfil)"
if [ "$PUERTO" = "sinpuerto" ]; then
  echo "ERROR: Chrome ya usa el perfil $PERFIL sin puerto de depuración."
  echo "Cierra esa ventana o ejecuta: REINICIAR=1 ./abrir_ferricentro.sh"
  exit 1
fi
if [ -n "$PUERTO" ] && ! esta_activo "$PUERTO"; then
  echo "ERROR: la sesión previa del perfil no responde en el puerto."
  echo "Cierra esa ventana o ejecuta: REINICIAR=1 ./abrir_ferricentro.sh"
  exit 1
fi

if [ -z "$PUERTO" ]; then
  PUERTO=9222
  while esta_activo "$PUERTO"; do PUERTO=$((PUERTO + 1)); done
  ARGS=(
    "--user-data-dir=$PERFIL"
    "--remote-debugging-port=$PUERTO"
    "--enable-unsafe-extension-debugging"
    "--no-first-run"
    "--no-default-browser-check"
    "--disable-session-crashed-bubble"
    "--hide-crash-restore-bubble"
    "--start-maximized"
  )
  if [ -z "${DISPLAY:-}" ]; then
    ARGS+=(--headless=new)
    echo "AVISO: sin DISPLAY, se abrirá Chrome en modo headless."
  fi
  echo "Abriendo Chrome (perfil $PERFIL, puerto $PUERTO)..."
  nohup google-chrome "${ARGS[@]}" "$URL" >/dev/null 2>&1 &
  for _ in $(seq 1 80); do
    if esta_activo "$PUERTO"; then break; fi
    sleep 0.5
  done
  if ! esta_activo "$PUERTO"; then
    echo "ERROR: Chrome no abrió con depuración en el puerto $PUERTO."
    echo "Probablemente otra instancia ya usa el perfil $PERFIL."
    exit 1
  fi
  mkdir -p "$PERFIL"
  echo "$PUERTO" > "$PUERTO_ARCHIVO"
else
  echo "Reutilizando Chrome ya abierto (puerto $PUERTO)."
fi

echo "Cargando extensión..."
SALIDA_EXT="$(python3 "$DIR/cargar_extension.py" "$PUERTO" "$EXT")"
echo "$SALIDA_EXT"
ID="$(printf '%s\n' "$SALIDA_EXT" | sed -n 's/.*ID: //p' | tail -1)"
if [ -n "$ID" ]; then
  echo "$ID" > "$ID_ARCHIVO"
else
  ID="$(cat "$ID_ARCHIVO" 2>/dev/null || true)"
fi
if [ -z "$ID" ]; then
  echo "ERROR: no se pudo determinar el ID de la extensión."
  exit 1
fi

if [ "$AUTO" = "1" ]; then
  echo "Ejecutando la extensión (analizar + descargar CSV)..."
  python3 "$DIR/usar_extension.py" --port "$PUERTO" --ext-id "$ID" --url "$URL"
fi

echo "Listo: navegador abierto en $URL con la extensión cargada."

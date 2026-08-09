#!/bin/bash
# Patcht Squeekboard auf Wayland-Layer OVERLAY (statt TOP).
#
# Hintergrund: Unter labwc liegt Fullscreen/Kiosk ÜBER Layer TOP.
# Squeekboard startet dann, ist aber hinter Chromium unsichtbar.
# Siehe: https://github.com/raspberrypi-ui/squeekboard/issues/13
#
# Aufruf auf dem Pi: bash ~/SmartHome/deploy/patch-squeekboard-overlay.sh
# Dauer: oft 15–40 Min (Kompilieren).

set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
  echo "Bitte NICHT als root ausführen (sudo wird bei Bedarf selbst genutzt)."
  exit 1
fi

WORKDIR="${TMPDIR:-/tmp}/squeekboard-overlay-build"
rm -rf "$WORKDIR"
mkdir -p "$WORKDIR"
cd "$WORKDIR"

echo "=== Squeekboard Overlay-Patch ==="
echo "Build-Verzeichnis: $WORKDIR"
echo ""

echo "[1/5] Build-Abhängigkeiten..."
sudo apt-get update
sudo apt-get install -y \
  build-essential debhelper devscripts fakeroot \
  meson ninja-build pkg-config \
  libgtk-3-dev libglib2.0-dev libwayland-dev \
  libxkbcommon-dev libfeedback-dev \
  rustc cargo \
  gnome-pkg-tools

# Quellpaket (Pi-OS Downstream-Patches inklusive)
echo "[2/5] Quellcode holen (apt source)..."
# deb-src muss aktiv sein
if ! grep -qrE '^deb-src' /etc/apt/sources.list /etc/apt/sources.list.d 2>/dev/null; then
  echo "deb-src Einträge fehlen — aktiviere sie temporär für raspberrypi..."
  # Pi OS Bookworm/Trixie typische Quelle
  if [ -f /etc/apt/sources.list.d/raspi.list ]; then
    sudo sed -i 's/^#\s*deb-src/deb-src/' /etc/apt/sources.list.d/raspi.list || true
  fi
  if [ -f /etc/apt/sources.list ]; then
    sudo sed -i 's/^#\s*deb-src/deb-src/' /etc/apt/sources.list || true
  fi
  sudo apt-get update
fi

apt-get source squeekboard
SRC_DIR=$(find . -maxdepth 1 -type d -name 'squeekboard-*' | head -n1)
if [ -z "$SRC_DIR" ]; then
  echo "Konnte squeekboard-Quellverzeichnis nicht finden."
  exit 1
fi
cd "$SRC_DIR"
echo "  Quelle: $SRC_DIR"

echo "[3/5] Layer TOP → OVERLAY patchen..."
# Upstream/Phosh: src/panel.c  |  RPi-Fork: oft gleiches Pattern irgendwo
MATCHES=$(grep -Rnl 'ZWLR_LAYER_SHELL_V1_LAYER_TOP' . 2>/dev/null || true)
if [ -z "$MATCHES" ]; then
  echo "Kein ZWLR_LAYER_SHELL_V1_LAYER_TOP gefunden — Abbruch."
  exit 1
fi

echo "$MATCHES" | while read -r f; do
  echo "  patch: $f"
  sed -i 's/ZWLR_LAYER_SHELL_V1_LAYER_TOP/ZWLR_LAYER_SHELL_V1_LAYER_OVERLAY/g' "$f"
done

# Zusätzlich: Forum-Workaround — Env SQUEEKBOARD_LAYER=overlay in set_layer
LAYER_C=$(find . -name 'layersurface.c' | head -n1 || true)
if [ -n "$LAYER_C" ] && grep -q 'phosh_layer_surface_set_layer' "$LAYER_C"; then
  if ! grep -q 'SQUEEKBOARD_LAYER' "$LAYER_C"; then
    echo "  env-hook in $LAYER_C"
    python3 - <<'PY'
from pathlib import Path
p = next(Path('.').rglob('layersurface.c'))
src = p.read_text()
needle = "phosh_layer_surface_set_layer (PhoshLayerSurface *self, guint32 layer)\n{\n"
hook = '''phosh_layer_surface_set_layer (PhoshLayerSurface *self, guint32 layer)
{
  /* SmartHome kiosk: allow overlay above fullscreen (labwc) */
  {
    const char *env = g_getenv ("SQUEEKBOARD_LAYER");
    if (env && g_ascii_strcasecmp (env, "overlay") == 0)
      layer = 3; /* ZWLR_LAYER_SHELL_V1_LAYER_OVERLAY */
  }
'''
if needle in src and 'SQUEEKBOARD_LAYER' not in src:
    p.write_text(src.replace(needle, hook, 1))
    print('  inserted SQUEEKBOARD_LAYER hook')
else:
    print('  skip env-hook (already present or signature mismatch)')
PY
  fi
fi

echo "[4/5] Paket bauen (kann lange dauern)..."
# -b: nur Binary, ohne Signatur
dpkg-buildpackage -us -uc -b

echo "[5/5] Installieren..."
DEB=$(ls -1 ../*squeekboard*.deb 2>/dev/null | grep -v -- '-dbgsym' | head -n1)
if [ -z "$DEB" ]; then
  echo "Kein .deb gefunden."
  exit 1
fi
sudo dpkg -i "$DEB" || sudo apt-get install -f -y

# Autostart/Session: Overlay-Env setzen (falls Hook aktiv)
ENV_FILE="$HOME/.config/environment.d/squeekboard-overlay.conf"
mkdir -p "$(dirname "$ENV_FILE")"
cat > "$ENV_FILE" <<'EOF'
SQUEEKBOARD_LAYER=overlay
EOF

# Chromium-Kiosk darf wieder echtes --kiosk nutzen
echo ""
echo "=== Fertig ==="
echo "Squeekboard neu starten (oder reboot):"
echo "  pkill squeekboard; SQUEEKBOARD_LAYER=overlay squeekboard &"
echo "  # danach Kiosk neu starten:"
echo "  bash ~/SmartHome/deploy/start-kiosk.sh"
echo ""
echo "Hinweis: apt upgrade kann das Paket wieder überschreiben."
echo "Dann dieses Skript erneut ausführen."

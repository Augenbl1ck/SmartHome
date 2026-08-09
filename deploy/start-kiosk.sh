#!/bin/bash
# SmartHome Chromium-Kiosk starten (Autostart vom Desktop)
#
# Squeekboard liegt standardmäßig auf Wayland-Layer TOP — darunter Fullscreen.
# Mit Overlay-Patch (deploy/patch-squeekboard-overlay.sh) liegt die Tastatur
# auf OVERLAY und ist über --kiosk sichtbar.
# Siehe: https://github.com/raspberrypi-ui/squeekboard/issues/13

set -e

URL="${SMARTHOME_KIOSK_URL:-http://smarthome.local?kiosk=1}"

sleep 3

export SQUEEKBOARD_LAYER=overlay
export GDK_BACKEND=wayland
export GTK_IM_MODULE=wayland
export QT_IM_MODULE=wayland
export XDG_SESSION_TYPE="${XDG_SESSION_TYPE:-wayland}"

if command -v squeekboard >/dev/null 2>&1; then
  pkill -x squeekboard 2>/dev/null || true
  SQUEEKBOARD_LAYER=overlay squeekboard &
  sleep 1
fi

CHROMIUM=""
for bin in chromium-browser chromium google-chrome; do
  if command -v "$bin" >/dev/null 2>&1; then
    CHROMIUM="$bin"
    break
  fi
done

if [ -z "$CHROMIUM" ]; then
  echo "Chromium nicht gefunden" >&2
  exit 1
fi

exec "$CHROMIUM" \
  --kiosk \
  --ozone-platform=wayland \
  --enable-features=UseOzonePlatform \
  --enable-wayland-ime \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-restore-session-state \
  --check-for-update-interval=604800 \
  --overscroll-history-navigation=0 \
  "$URL"

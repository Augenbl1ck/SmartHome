#!/bin/bash
# SmartHome Chromium-Kiosk starten (Autostart vom Desktop)
# Wichtig: als Wrapper, damit Wayland/Squeekboard wie beim manuellen Chrome greifen.

set -e

URL="${SMARTHOME_KIOSK_URL:-http://smarthome.local?kiosk=1}"

# Kurz warten, bis Session/Compositor/Squeekboard bereit sind
sleep 3

# Squeekboard (Pi-Bildschirmtastatur) sicherstellen — nur Wayland
if command -v squeekboard >/dev/null 2>&1; then
  if ! pgrep -x squeekboard >/dev/null 2>&1; then
    squeekboard &
    sleep 1
  fi
fi

# Chromium-Binary finden (je nach Pi-OS-Version)
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

# Wie manueller Desktop-Start: Wayland-Client, damit Squeekboard auf Fokus reagiert.
# --kiosk allein läuft oft unter XWayland → dann keine OSK.
exec "$CHROMIUM" \
  --kiosk \
  --ozone-platform=wayland \
  --enable-features=UseOzonePlatform,OverlayScrollbar \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-restore-session-state \
  --check-for-update-interval=604800 \
  --overscroll-history-navigation=0 \
  "$URL"

#!/bin/bash
# SmartHome Chromium Autostart
#
# Kein --kiosk: sperrt F11/Exit und legt Fullscreen über die System-OSK.
# App-Kiosk (UI) kommt über ?kiosk=1; Eingabe über die In-App-Tastatur.

set -e

URL="${SMARTHOME_KIOSK_URL:-http://smarthome.local?kiosk=1}"

sleep 2

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
  --app="$URL" \
  --start-maximized \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-restore-session-state \
  --check-for-update-interval=604800 \
  --overscroll-history-navigation=0 \
  --window-position=0,0

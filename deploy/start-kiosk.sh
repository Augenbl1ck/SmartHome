#!/bin/bash
# SmartHome Chromium Autostart (Vollbild + App-Kiosk)
#
# - --start-fullscreen: echter Vollbild-Start, F11 kann beenden (anders als --kiosk)
# - App-Kiosk: ?kiosk=1 + #kiosk → Bottom-Bar, keine NavBar
# - Eingabe: In-App-Tastatur (Squeekboard optional via a11y/dbus)

set -e

URL="${SMARTHOME_KIOSK_URL:-http://smarthome.local/?kiosk=1#kiosk}"

sleep 2

# Optional: GNOME/Pi Accessibility-Bildschirmtastatur aktivieren
if command -v gsettings >/dev/null 2>&1; then
  gsettings set org.gnome.desktop.a11y.applications screen-keyboard-enabled true 2>/dev/null || true
fi

# Optional: Squeekboard Overlay-Layer anfordern (falls D-Bus-Methode existiert)
if command -v dbus-send >/dev/null 2>&1; then
  dbus-send --session --type=method_call \
    --dest=sm.puri.OSK0 /sm/puri/OSK0 \
    sm.puri.OSK0.SetLayer int32:3 2>/dev/null || true
fi

if command -v squeekboard >/dev/null 2>&1; then
  if ! pgrep -x squeekboard >/dev/null 2>&1; then
    squeekboard &
    sleep 1
  fi
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

# Frisches Profil-Flag-Set: Query+Hash für App-Kiosk; Fullscreen statt Lock-Kiosk
exec "$CHROMIUM" \
  --app="$URL" \
  --start-fullscreen \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-restore-session-state \
  --check-for-update-interval=604800 \
  --overscroll-history-navigation=0

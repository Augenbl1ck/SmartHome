#!/bin/bash
# SmartHome Chromium Autostart (echtes Vollbild + App-Kiosk)
#
# - --kiosk: zuverlässiger Vollbild-Start auf Pi/labwc (anders als --app + --start-fullscreen)
# - App-Kiosk: ?kiosk=1 + #kiosk -> Bottom-Bar, keine NavBar
# - Eingabe: In-App-Tastatur (kein System-OSK nötig)

set -e

URL="${SMARTHOME_KIOSK_URL:-http://smarthome.local/?kiosk=1#kiosk}"

sleep 2

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DISPLAY_CMD_FILE="/tmp/smarthome-display-cmd"
echo on > "$DISPLAY_CMD_FILE"
chmod 666 "$DISPLAY_CMD_FILE" 2>/dev/null || true

# Display ein/aus im Kontext der grafischen Session (labwc / wlr-randr)
(
  last=""
  while :; do
    cur="$(tr -d '[:space:]' < "$DISPLAY_CMD_FILE" 2>/dev/null || true)"
    if [ -n "$cur" ] && [ "$cur" != "$last" ]; then
      last="$cur"
      bash "$SCRIPT_DIR/display-power.sh" "$cur" >/dev/null 2>&1 || true
    fi
    sleep 0.3
  done
) &
DISPLAY_WATCH_PID=$!
trap 'kill "$DISPLAY_WATCH_PID" 2>/dev/null || true' EXIT

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

# Abgestuerzte Session-Markierung zuruecksetzen (kein Restore-Dialog)
PREFS="$HOME/.config/chromium/Default/Preferences"
if [ -f "$PREFS" ]; then
  sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/g' "$PREFS" 2>/dev/null || true
fi

# Kein GNOME-Keyring-Dialog nach Reboot (Autologin / kein Login-Passwort)
exec "$CHROMIUM" \
  --password-store=basic \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-restore-session-state \
  --check-for-update-interval=604800 \
  --overscroll-history-navigation=0 \
  --enable-features=OverlayScrollbar \
  "$URL"

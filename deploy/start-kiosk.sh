#!/bin/bash
# SmartHome Chromium Autostart (Vollbild + App-Kiosk)
#
# - --start-fullscreen: echter Vollbild-Start, F11 kann beenden (anders als --kiosk)
# - App-Kiosk: ?kiosk=1 + #kiosk → Bottom-Bar, keine NavBar
# - Eingabe: In-App-Tastatur (kein Squeekboard / kein Keyring-Prompt)

set -e

URL="${SMARTHOME_KIOSK_URL:-http://smarthome.local/?kiosk=1#kiosk}"

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

# Optional: abgestürzte Session-Markierung zurücksetzen (kein Restore-Dialog)
PREFS="$HOME/.config/chromium/Default/Preferences"
if [ -f "$PREFS" ]; then
  sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/g' "$PREFS" 2>/dev/null || true
fi

exec "$CHROMIUM" \
  --app="$URL" \
  --start-fullscreen \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-restore-session-state \
  --disable-features=PasswordManagerOnboarding,TranslateUI \
  --password-store=basic \
  --disable-save-password-bubble \
  --check-for-update-interval=604800 \
  --overscroll-history-navigation=0

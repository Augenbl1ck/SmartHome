#!/bin/bash
# SmartHome Chromium-Kiosk starten (Autostart vom Desktop)
#
# WICHTIG: Kein --kiosk / kein echtes Fullscreen!
# Unter Wayland (labwc) liegt Squeekboard auf Layer TOP — darunter liegt
# ein Fullscreen-Fenster. Die Tastatur startet dann, ist aber unsichtbar.
# Stattdessen: App-Fenster ohne Browser-UI, maximiert (füllt den Screen).

set -e

URL="${SMARTHOME_KIOSK_URL:-http://smarthome.local?kiosk=1}"

# Kurz warten, bis Session/Compositor/Squeekboard bereit sind
sleep 3

# Squeekboard (Pi-Bildschirmtastatur) sicherstellen
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

# Wayland-IME, damit Fokus-Events Squeekboard erreichen
export GDK_BACKEND=wayland
export GTK_IM_MODULE=wayland
export QT_IM_MODULE=wayland
export XDG_SESSION_TYPE="${XDG_SESSION_TYPE:-wayland}"

# --app = ohne Adressleiste/Tabs (wie Kiosk-Optik)
# --start-maximized = voller Screen OHNE compositor-fullscreen
# Kein --kiosk, kein --start-fullscreen → sonst keine sichtbare OSK
exec "$CHROMIUM" \
  --app="$URL" \
  --start-maximized \
  --ozone-platform=wayland \
  --enable-features=UseOzonePlatform,WaylandWindowDecorations \
  --enable-wayland-ime \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-restore-session-state \
  --check-for-update-interval=604800 \
  --overscroll-history-navigation=0 \
  --window-position=0,0

#!/bin/bash
# HDMI / Hintergrundlicht am Raspberry-Kiosk ein- oder ausschalten.
# Wird vom Kiosk-User (start-kiosk.sh) und optional vom Backend aufgerufen.
#
#   display-power.sh on|off

set -u

ACTION="${1:-}"
if [ "$ACTION" != "on" ] && [ "$ACTION" != "off" ]; then
  echo "usage: $0 on|off" >&2
  exit 1
fi

try_vcgencmd() {
  command -v vcgencmd >/dev/null 2>&1 || return 0
  if [ "$ACTION" = on ]; then
    vcgencmd display_power 1 >/dev/null 2>&1 || true
  else
    vcgencmd display_power 0 >/dev/null 2>&1 || true
  fi
}

try_backlight() {
  local bl dir max
  for bl in /sys/class/backlight/*/bl_power; do
    [ -e "$bl" ] || continue
    if [ "$ACTION" = on ]; then
      echo 0 > "$bl" 2>/dev/null || true
    else
      echo 4 > "$bl" 2>/dev/null || true
    fi
  done
  for bl in /sys/class/backlight/*/brightness; do
    [ -e "$bl" ] || continue
    dir="$(dirname "$bl")"
    if [ "$ACTION" = on ]; then
      max=255
      if [ -f "$dir/max_brightness" ]; then
        max="$(cat "$dir/max_brightness" 2>/dev/null || echo 255)"
      fi
      echo "$max" > "$bl" 2>/dev/null || true
    else
      echo 0 > "$bl" 2>/dev/null || true
    fi
  done
}

try_fbblank() {
  local f
  for f in /sys/class/graphics/fb*/blank; do
    [ -e "$f" ] || continue
    if [ "$ACTION" = on ]; then
      echo 0 > "$f" 2>/dev/null || true
    else
      echo 1 > "$f" 2>/dev/null || true
    fi
  done
}

try_wlr() {
  command -v wlr-randr >/dev/null 2>&1 || return 0
  local out
  while read -r out; do
    [ -n "$out" ] || continue
    if [ "$ACTION" = on ]; then
      wlr-randr --output "$out" --on >/dev/null 2>&1 || true
    else
      wlr-randr --output "$out" --off >/dev/null 2>&1 || true
    fi
  done < <(wlr-randr 2>/dev/null | awk '/^[A-Za-z0-9-]+ / { print $1 }')
}

try_xset() {
  command -v xset >/dev/null 2>&1 || return 0
  if [ "$ACTION" = on ]; then
    xset dpms force on >/dev/null 2>&1 || true
    xset s reset >/dev/null 2>&1 || true
  else
    xset dpms force off >/dev/null 2>&1 || true
  fi
}

try_vcgencmd
try_backlight
try_fbblank
try_wlr
try_xset

exit 0

#!/bin/bash
# Monitor-Standby am Raspberry-Kiosk (HDMI-Touch, z. B. ROADom 10").
#
# Reihenfolge beim Ausschalten:
#   1. DDC/CI  — echter Power/Standby-Befehl an den Monitor (HDMI bleibt)
#   2. HDMI-CEC — TV-ähnliche Geräte
#   3. Fallback — HDMI-Ausgang / Hintergrundlicht am Pi
#
#   display-power.sh on|off
#
# Pakete (einmalig):  bash deploy/install-display-power.sh

set -u

ACTION="${1:-}"
if [ "$ACTION" != "on" ] && [ "$ACTION" != "off" ]; then
  echo "usage: $0 on|off" >&2
  exit 1
fi

DDC_TIMEOUT="${DDC_TIMEOUT:-6}"

run_timeout() {
  if command -v timeout >/dev/null 2>&1; then
    timeout "$DDC_TIMEOUT" "$@"
  else
    "$@"
  fi
}

# VCP D6: 1=On, 4=Standby, 5=Off (je nach Panel)
try_ddc() {
  command -v ddcutil >/dev/null 2>&1 || return 1
  if [ "$ACTION" = on ]; then
    run_timeout ddcutil dpms on >/dev/null 2>&1 && return 0
    run_timeout ddcutil setvcp D6 1 >/dev/null 2>&1 && return 0
    return 1
  fi
  run_timeout ddcutil dpms off >/dev/null 2>&1 && return 0
  run_timeout ddcutil setvcp D6 5 >/dev/null 2>&1 && return 0
  run_timeout ddcutil setvcp D6 4 >/dev/null 2>&1 && return 0
  return 1
}

try_cec() {
  local dev
  if command -v cec-ctl >/dev/null 2>&1; then
    for dev in /dev/cec0 /dev/cec1; do
      [ -e "$dev" ] || continue
      if [ "$ACTION" = on ]; then
        cec-ctl -d "$dev" --to 0 --image-view-on >/dev/null 2>&1 && return 0
        cec-ctl -d "$dev" --to 0 --user-control-pressed power >/dev/null 2>&1 && return 0
      else
        cec-ctl -d "$dev" --to 0 --standby >/dev/null 2>&1 && return 0
      fi
    done
  fi
  if command -v cec-client >/dev/null 2>&1; then
    if [ "$ACTION" = on ]; then
      printf 'on 0\n' | cec-client -s -d 1 >/dev/null 2>&1 && return 0
    else
      printf 'standby 0\n' | cec-client -s -d 1 >/dev/null 2>&1 && return 0
    fi
  fi
  return 1
}

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

if [ "$ACTION" = on ]; then
  # HDMI-Signal zuerst, dann Monitor per DDC/CEC wecken
  try_vcgencmd
  try_backlight
  try_fbblank
  try_wlr
  try_xset
  try_ddc || true
  try_cec || true
else
  # DDC/CEC brauchen die HDMI-Verbindung — nicht zuerst trennen
  if try_ddc || try_cec; then
    exit 0
  fi
  try_xset
  try_vcgencmd
  try_backlight
  try_fbblank
  try_wlr
fi

exit 0

#!/bin/bash
# DDC/CI + CEC fürs Kiosk-Display (ROADom HDMI-Touch u. a.)
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  exec sudo bash "$0" "$@"
fi

TARGET_USER="${SUDO_USER:-pi}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y ddcutil cec-utils v4l-utils

if getent group i2c >/dev/null; then
  usermod -aG i2c "$TARGET_USER"
fi
if getent group video >/dev/null; then
  usermod -aG video "$TARGET_USER"
fi

echo
echo "Installiert. Danach einmal neu einloggen (oder Pi neu starten), damit die i2c-Gruppe greift."
echo "Test:  sudo -u $TARGET_USER ddcutil detect"
echo "Aus:   bash $(dirname "$0")/display-power.sh off"
echo "An:    bash $(dirname "$0")/display-power.sh on"

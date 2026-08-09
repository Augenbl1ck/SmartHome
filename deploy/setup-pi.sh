#!/bin/bash
# SmartHome Raspberry Pi Setup
# Aufruf: bash setup-pi.sh
# Voraussetzung: Git-Repo bereits nach /home/pi/smarthome geklont

set -e

INSTALL_DIR="/home/pi/smarthome"
DEPLOY_DIR="${INSTALL_DIR}/deploy"

echo "=== SmartHome Raspberry Pi Setup ==="

# Node.js 20 installieren (falls nicht vorhanden)
if ! command -v node &> /dev/null; then
  echo "[1/6] Node.js installieren..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# Bluetooth-Bibliotheken fuer noble
echo "[2/6] Bluetooth-Bibliotheken installieren..."
sudo apt-get install -y bluetooth bluez libbluetooth-dev libudev-dev

# BLE Bridge Dependencies
echo "[3/6] BLE Bridge installieren..."
cd "${INSTALL_DIR}/ble-bridge"
npm install

# Node.js Bluetooth-Berechtigungen
sudo setcap cap_net_raw+eip $(eval readlink -f `which node`)

# PHP installieren (falls nicht vorhanden)
if ! command -v php &> /dev/null; then
  echo "[4/6] PHP installieren..."
  sudo apt-get install -y php php-sqlite3 php-xml php-curl php-mbstring composer
fi

# Laravel Dependencies
echo "[5/6] Laravel installieren..."
cd "${INSTALL_DIR}/backend"
composer install --no-dev --optimize-autoloader
php artisan migrate --force
php artisan config:cache
php artisan route:cache

# systemd Services installieren
echo "[6/6] systemd Services installieren..."
sudo cp "${DEPLOY_DIR}/smarthome-ble-bridge.service" /etc/systemd/system/
sudo cp "${DEPLOY_DIR}/smarthome-scheduler.service"  /etc/systemd/system/
sudo cp "${DEPLOY_DIR}/smarthome-backend.service"    /etc/systemd/system/
sudo cp "${DEPLOY_DIR}/smarthome-frontend.service"   /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable  smarthome-ble-bridge smarthome-scheduler smarthome-backend smarthome-frontend
sudo systemctl restart smarthome-ble-bridge smarthome-scheduler smarthome-backend smarthome-frontend

# Kiosk-Autostart einrichten (Chromium mit virtueller Tastatur)
echo "[7/7] Kiosk-Autostart einrichten..."
AUTOSTART_DIR="/home/pi/.config/autostart"
mkdir -p "$AUTOSTART_DIR"
cp "${DEPLOY_DIR}/smarthome-kiosk.desktop" "$AUTOSTART_DIR/smarthome-kiosk.desktop"

# Chromium-Einstellungen: "Wiederherstellen"-Dialog beim Start unterdrücken
CHROMIUM_PREFS="/home/pi/.config/chromium/Default/Preferences"
if [ -f "$CHROMIUM_PREFS" ]; then
  # exit_type auf Normal setzen damit kein "Browser wurde unerwartet beendet" erscheint
  sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/g' "$CHROMIUM_PREFS" 2>/dev/null || true
fi

echo ""
echo "=== Setup abgeschlossen ==="
echo "Backend:    http://$(hostname -I | awk '{print $1}'):8000"
echo "Frontend:   http://$(hostname -I | awk '{print $1}'):3000"
echo "BLE Bridge: http://127.0.0.1:3001 (nur intern)"
echo ""
echo "Kiosk-Browser startet automatisch beim nächsten Login."
echo "Virtuelle Tastatur: Chromium --enable-virtual-keyboard aktiv."
echo ""
echo "Logs:"
echo "  journalctl -u smarthome-ble-bridge -f"
echo "  journalctl -u smarthome-scheduler -f"

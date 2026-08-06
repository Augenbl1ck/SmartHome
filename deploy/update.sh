#!/bin/bash
# SmartHome Update Script
# Aufruf: bash ~/SmartHome/deploy/update.sh

set -e

INSTALL_DIR="/home/pi/SmartHome"

echo "=== SmartHome Update ==="

cd "$INSTALL_DIR"

echo "[1/5] Code aktualisieren..."
git pull

echo "[2/5] Backend-Abhängigkeiten..."
cd "$INSTALL_DIR/backend"
php8.4 /usr/local/bin/composer install --no-dev --optimize-autoloader
php8.4 artisan migrate --force
php8.4 artisan config:cache
php8.4 artisan route:cache

echo "[3/5] Frontend bauen..."
cd "$INSTALL_DIR/frontend"
npm install
npm run build

echo "[4/5] Services neu starten..."
sudo systemctl restart \
  smarthome-backend \
  smarthome-frontend \
  smarthome-mqtt-subscriber \
  smarthome-reverb \
  smarthome-queue \
  smarthome-scheduler

echo "[5/5] Status prüfen..."
sudo systemctl is-active --quiet smarthome-backend  && echo "  backend      ✓" || echo "  backend      ✗"
sudo systemctl is-active --quiet smarthome-frontend && echo "  frontend     ✓" || echo "  frontend     ✗"
sudo systemctl is-active --quiet smarthome-mqtt-subscriber && echo "  mqtt-sub     ✓" || echo "  mqtt-sub     ✗"
sudo systemctl is-active --quiet smarthome-reverb   && echo "  reverb       ✓" || echo "  reverb       ✗"
sudo systemctl is-active --quiet smarthome-queue    && echo "  queue        ✓" || echo "  queue        ✗"

echo ""
echo "=== Update abgeschlossen ==="
echo "App: http://$(hostname -I | awk '{print $1}')"

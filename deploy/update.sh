#!/bin/bash
# SmartHome Update Script
# Aufruf: bash ~/SmartHome/deploy/update.sh

set -e

INSTALL_DIR="/home/pi/SmartHome"

# +x ist für systemd (bash script.sh) nicht nötig. chmod darf das Update nicht killen
# (root-Owner, immutable, merkwürdiges FS).
ensure_exec() {
  local f="$1"
  [ -f "$f" ] || return 0
  chmod +x "$f" 2>/dev/null && return 0
  sudo chmod +x "$f" 2>/dev/null && return 0
  sudo chattr -i "$f" 2>/dev/null || true
  sudo chmod +x "$f" 2>/dev/null || true
}

echo "=== SmartHome Update ==="

cd "$INSTALL_DIR"

echo "[1/7] Code aktualisieren..."
# Lokale Deploy-Skript-Änderungen verwerfen (Autostart-Edits auf dem Pi)
git checkout -- deploy 2>/dev/null || true

BRANCH_FILE="$HOME/.config/smarthome/branch"
mkdir -p "$HOME/.config/smarthome"
if [ -f "$BRANCH_FILE" ]; then
  BRANCH=$(tr -d '[:space:]' < "$BRANCH_FILE")
else
  BRANCH=$(git rev-parse --abbrev-ref HEAD)
  printf '%s\n' "$BRANCH" > "$BRANCH_FILE"
fi
if [ "$BRANCH" = "main" ]; then
  BRANCH=master
  printf '%s\n' "$BRANCH" > "$BRANCH_FILE"
fi
echo "  Branch: $BRANCH"
git fetch origin "$BRANCH"
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Lokale Änderungen blockieren das Update:"
  git diff --name-only
  git diff --cached --name-only
  exit 1
fi
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "[2/7] Backend-Abhängigkeiten..."
cd "$INSTALL_DIR/backend"
php8.4 /usr/local/bin/composer install --no-dev --optimize-autoloader
php8.4 artisan migrate --force
php8.4 artisan config:cache
php8.4 artisan route:cache

echo "[3/7] php-fpm + API-Nginx..."
ensure_exec "$INSTALL_DIR/deploy/run-backend.sh"
ensure_exec "$INSTALL_DIR/deploy/fix-api-502.sh"
# artisan serve stoppen — niemals fuser -k 8000 (das killt Nginx, der :8000 hält).
sudo systemctl stop smarthome-backend 2>/dev/null || true
sudo pkill -f 'artisan serve --host' 2>/dev/null || true
sleep 1
if [ -d /etc/php/8.4/fpm/pool.d ]; then
  sudo cp "$INSTALL_DIR/deploy/php8.4-fpm-smarthome.conf" /etc/php/8.4/fpm/pool.d/smarthome.conf
  sudo systemctl enable php8.4-fpm >/dev/null 2>&1 || true
  sudo systemctl restart php8.4-fpm
  echo "  php-fpm      ✓"
else
  echo "  php-fpm      ✗  (sudo apt install php8.4-fpm)"
fi
if [ -d /etc/nginx/sites-available ]; then
  sudo cp "$INSTALL_DIR/deploy/smarthome-api-php-fpm.conf" /etc/nginx/sites-available/smarthome-api
  sudo ln -sf /etc/nginx/sites-available/smarthome-api /etc/nginx/sites-enabled/smarthome-api
  if [ -f /etc/nginx/sites-available/smarthome ]; then
    sudo cp "$INSTALL_DIR/deploy/smarthome-nginx.conf" /etc/nginx/sites-available/smarthome
  fi
  sudo nginx -t
  if sudo systemctl is-active --quiet nginx; then
    sudo systemctl reload nginx
  else
    sudo systemctl start nginx
  fi
  echo "  nginx :8000  ✓"
else
  echo "  nginx        ✗"
fi
sudo cp "$INSTALL_DIR/deploy/smarthome-backend.service" /etc/systemd/system/smarthome-backend.service
sudo systemctl daemon-reload

echo "[4/7] Frontend bauen..."
cd "$INSTALL_DIR/frontend"
npm install
npm run build

echo "[5/7] Autostart aktualisieren..."
ensure_exec "$INSTALL_DIR/deploy/start-kiosk.sh"
mkdir -p ~/.config/autostart
cp "$INSTALL_DIR/deploy/smarthome-kiosk.desktop" ~/.config/autostart/smarthome-kiosk.desktop
echo "  autostart    ✓"

echo "[6/7] Services neu starten..."
sudo systemctl restart \
  smarthome-backend \
  smarthome-frontend \
  smarthome-mqtt-subscriber \
  smarthome-reverb \
  smarthome-queue \
  smarthome-scheduler

echo "[7/7] Widget-Cache vorwärmen..."
cd "$INSTALL_DIR/backend"
php8.4 artisan dashboard:refresh-cache || echo "  cache        ✗"

echo "[Status]"
sudo systemctl is-active --quiet nginx && echo "  nginx        ✓" || echo "  nginx        ✗"
sudo systemctl is-active --quiet php8.4-fpm && echo "  php-fpm      ✓" || echo "  php-fpm      ✗"
sudo systemctl is-active --quiet smarthome-backend  && echo "  backend      ✓" || echo "  backend      ✗"
sudo systemctl is-active --quiet smarthome-frontend && echo "  frontend     ✓" || echo "  frontend     ✗"
sudo systemctl is-active --quiet smarthome-mqtt-subscriber && echo "  mqtt-sub     ✓" || echo "  mqtt-sub     ✗"
sudo systemctl is-active --quiet smarthome-reverb   && echo "  reverb       ✓" || echo "  reverb       ✗"
sudo systemctl is-active --quiet smarthome-queue    && echo "  queue        ✓" || echo "  queue        ✗"
sudo systemctl is-active --quiet smarthome-scheduler && echo "  scheduler    ✓" || echo "  scheduler    ✗"

mkdir -p "$HOME/.local/bin"
cp "$INSTALL_DIR/deploy/use-branch.sh" "$HOME/.local/bin/smarthome-branch"
chmod +x "$HOME/.local/bin/smarthome-branch" 2>/dev/null || true

echo ""
echo "=== Update abgeschlossen ==="
echo "Branch: $BRANCH"
echo "Wechseln: bash ~/.local/bin/smarthome-branch master"
echo "          bash ~/.local/bin/smarthome-branch design/ha-ui"
echo "App: http://$(hostname -I | awk '{print $1}')"

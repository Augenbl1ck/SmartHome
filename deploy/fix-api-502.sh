#!/bin/bash
# Stellt die API nach 502 wieder her (ohne Frontend-Build).
# Aufruf: bash ~/SmartHome/deploy/fix-api-502.sh
set -e
INSTALL_DIR="${INSTALL_DIR:-/home/pi/SmartHome}"

echo "=== API-502 Fix ==="

echo "[1] artisan serve / Dummy-Backend stoppen, Port 8000 freimachen..."
sudo systemctl stop smarthome-backend 2>/dev/null || true
sudo fuser -k 8000/tcp 2>/dev/null || true
sleep 1

echo "[2] php-fpm Pool..."
if [ ! -d /etc/php/8.4/fpm/pool.d ]; then
  echo "php8.4-fpm fehlt. sudo apt install php8.4-fpm"
  exit 1
fi
sudo cp "$INSTALL_DIR/deploy/php8.4-fpm-smarthome.conf" /etc/php/8.4/fpm/pool.d/smarthome.conf
sudo systemctl enable php8.4-fpm >/dev/null 2>&1 || true
sudo systemctl restart php8.4-fpm
sleep 1
if [ ! -S /run/php/php8.4-fpm-smarthome.sock ]; then
  echo "Socket fehlt. php-fpm Log:"
  sudo journalctl -u php8.4-fpm -n 30 --no-pager || true
  exit 1
fi
echo "  socket ✓"

echo "[3] Nginx API :8000 + /api/ → php-fpm..."
if [ -d /etc/nginx/sites-available ]; then
  sudo cp "$INSTALL_DIR/deploy/smarthome-api-php-fpm.conf" /etc/nginx/sites-available/smarthome-api
  sudo ln -sf /etc/nginx/sites-available/smarthome-api /etc/nginx/sites-enabled/smarthome-api
  sudo nginx -t
  sudo systemctl reload nginx
fi
sleep 1

echo "[4] Backend-Unit..."
chmod +x "$INSTALL_DIR/deploy/run-backend.sh"
sudo cp "$INSTALL_DIR/deploy/smarthome-backend.service" /etc/systemd/system/smarthome-backend.service
sudo systemctl daemon-reload
sudo systemctl start smarthome-backend

echo "[5] Test..."
code=$(curl -sS -m 5 -o /tmp/smarthome-api-test.json -w '%{http_code}' http://127.0.0.1:8000/api/v1/bootstrap || echo 000)
echo "  :8000/api/v1/bootstrap → HTTP $code"
if [ "$code" != "200" ]; then
  echo "  Fallback: artisan serve (Port 8000 muss frei sein)"
  sudo systemctl stop smarthome-backend || true
  sudo fuser -k 8000/tcp 2>/dev/null || true
  sudo rm -f /etc/nginx/sites-enabled/smarthome-api
  # Alten run-backend.sh (sleep sobald Socket da) austricksen:
  sudo mv /etc/php/8.4/fpm/pool.d/smarthome.conf /etc/php/8.4/fpm/pool.d/smarthome.conf.disabled 2>/dev/null || true
  sudo systemctl restart php8.4-fpm
  sudo nginx -t && sudo systemctl reload nginx
  sudo systemctl start smarthome-backend
  sleep 2
  code=$(curl -sS -m 5 -o /tmp/smarthome-api-test.json -w '%{http_code}' http://127.0.0.1:8000/api/v1/bootstrap || echo 000)
  echo "  artisan :8000 → HTTP $code"
fi

echo ""
echo "php-fpm:  $(systemctl is-active php8.4-fpm)"
echo "backend:  $(systemctl is-active smarthome-backend)"
echo "nginx:    $(systemctl is-active nginx)"
echo "Fertig. Seite neu laden."

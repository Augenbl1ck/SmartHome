#!/bin/bash
# Laravel-API: php-fpm wenn Socket UND Port 8000 erreichbar, sonst artisan serve.
set -e
SOCK="${SMARTHOME_FPM_SOCK:-/run/php/php8.4-fpm-smarthome.sock}"
BACKEND="${SMARTHOME_BACKEND:-/home/pi/SmartHome/backend}"

fpm_ok() {
  [ -S "$SOCK" ] || return 1
  code=$(curl -sS -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/api/v1/bootstrap 2>/dev/null || echo 000)
  [ "$code" = "200" ]
}

if fpm_ok; then
  echo "[smarthome-backend] php-fpm + nginx :8000 ok — kein artisan serve"
  exec sleep infinity
fi

echo "[smarthome-backend] php-fpm/nginx :8000 nicht bereit — Fallback artisan serve" >&2
cd "$BACKEND"
exec /usr/bin/php8.4 artisan serve --host=0.0.0.0 --port=8000

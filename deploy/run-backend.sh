#!/bin/bash
# Laravel-API: php-fpm wenn der Socket da ist, sonst artisan serve (lokal/Dev).
set -e
SOCK="${SMARTHOME_FPM_SOCK:-/run/php/php8.4-fpm-smarthome.sock}"
BACKEND="${SMARTHOME_BACKEND:-/home/pi/SmartHome/backend}"

if [ -S "$SOCK" ]; then
  echo "[smarthome-backend] php-fpm socket $SOCK — kein artisan serve"
  exec sleep infinity
fi

echo "[smarthome-backend] kein php-fpm — Fallback artisan serve :8000" >&2
cd "$BACKEND"
exec /usr/bin/php8.4 artisan serve --host=0.0.0.0 --port=8000

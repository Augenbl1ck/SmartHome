#!/usr/bin/env bash
#
# Idempotent repository bootstrap for the SmartHome Cloud Agent environment.
# Prepares the Laravel backend, the Next.js frontend, and the BLE bridge so
# that the services defined in .cursor/environment.json can start.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# -----------------------------------------------------------------------------
# Backend (Laravel 11 / PHP 8.4)
# -----------------------------------------------------------------------------
cd "$ROOT/backend"

composer install --no-interaction --no-progress --prefer-dist

# Local .env (gitignored) — SQLite dev database, MQTT on localhost.
if [ ! -f .env ]; then
  cp .env.example .env
fi

# Application key.
if ! grep -qE '^APP_KEY=base64:' .env; then
  php artisan key:generate --force
fi

# Reverb (WebSocket) credentials. Generate stable values only when empty so
# re-running install does not rotate keys the frontend already points at.
set_if_empty() {
  local key="$1" value="$2" current
  current="$(grep -E "^${key}=" .env | head -1 | cut -d= -f2- || true)"
  if [ -z "$current" ]; then
    # Use a temp file to safely replace the line regardless of special chars.
    awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k{print k "=" v; next} {print}' .env > .env.tmp && mv .env.tmp .env
  fi
}
set_if_empty REVERB_APP_ID     "$(php -r 'echo random_int(100000,999999);')"
set_if_empty REVERB_APP_KEY    "$(php -r 'echo bin2hex(random_bytes(10));')"
set_if_empty REVERB_APP_SECRET "$(php -r 'echo bin2hex(random_bytes(10));')"

# SQLite database. Seed only on first creation so re-installs stay idempotent
# (the seeder inserts a fixed-email user that would violate the unique index).
if [ ! -f database/database.sqlite ]; then
  touch database/database.sqlite
  php artisan migrate --force --seed
else
  php artisan migrate --force
fi

php artisan config:clear >/dev/null 2>&1 || true

REVERB_KEY="$(grep -E '^REVERB_APP_KEY=' .env | head -1 | cut -d= -f2-)"

# -----------------------------------------------------------------------------
# Frontend (Next.js 16)
# -----------------------------------------------------------------------------
cd "$ROOT/frontend"

npm ci --no-audit --no-fund

# Local frontend env (gitignored). Reverb key must match the backend value.
if [ ! -f .env.local ]; then
  cat > .env.local <<EOF
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
API_URL=http://localhost:8000/api/v1
NEXT_PUBLIC_REVERB_APP_KEY=${REVERB_KEY}
NEXT_PUBLIC_REVERB_HOST=localhost
NEXT_PUBLIC_REVERB_PORT=8080
NEXT_PUBLIC_REVERB_SCHEME=http
EOF
fi

# -----------------------------------------------------------------------------
# BLE bridge (Node.js daemon)
# -----------------------------------------------------------------------------
cd "$ROOT/ble-bridge"

npm ci --no-audit --no-fund

echo "SmartHome install complete."

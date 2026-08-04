#!/bin/bash
# =============================================================================
# SmartHome – Deploy-Skript für Raspberry Pi
#
# Verwendung:
#   ./deploy.sh           – Update: git pull, dependencies, migrate, restart
#   ./deploy.sh --setup   – Ersteinrichtung: + systemd-Services anlegen
# =============================================================================

set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
SETUP=false
PHP="php"
NPM="npm"
PI_USER="${SUDO_USER:-pi}"

# Farben
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${GREEN}[✓]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
section() { echo -e "\n${YELLOW}=== $1 ===${NC}"; }

# Argumente
for arg in "$@"; do
  case $arg in --setup) SETUP=true ;; esac
done

echo -e "${GREEN}"
echo "  ╔══════════════════════════════════╗"
echo "  ║   SmartHome Deploy               ║"
echo "  ╚══════════════════════════════════╝"
echo -e "${NC}"

# =============================================================================
# 1. Git Pull
# =============================================================================
section "1. Repository aktualisieren"
git -C "$REPO_DIR" pull origin main
info "Git pull abgeschlossen"

# =============================================================================
# 2. Backend
# =============================================================================
section "2. Backend (Laravel)"
cd "$REPO_DIR/backend"

composer install --no-dev --optimize-autoloader --no-interaction
info "Composer-Abhängigkeiten installiert"

# .env anlegen falls nicht vorhanden
if [ ! -f .env ]; then
  warn ".env nicht gefunden – kopiere .env.example"
  cp .env.example .env
  $PHP artisan key:generate
  warn "Bitte .env manuell befüllen (DB, MQTT, Reverb) und deploy erneut ausführen!"
  exit 1
fi

$PHP artisan migrate --force
info "Datenbank-Migrations ausgeführt"

$PHP artisan config:cache
$PHP artisan route:cache
$PHP artisan event:cache
info "Caches geleert und neu aufgebaut"

# =============================================================================
# 3. Frontend
# =============================================================================
section "3. Frontend (Next.js)"
cd "$REPO_DIR/frontend"

if [ ! -f .env.local ]; then
  warn ".env.local nicht gefunden – bitte anlegen (NEXT_PUBLIC_API_URL, REVERB-Keys)"
fi

$NPM ci --prefer-offline
$NPM run build
info "Frontend gebaut"

# =============================================================================
# 4. Systemd Services (nur bei --setup)
# =============================================================================
if [ "$SETUP" = true ]; then
  section "4. Systemd Services einrichten"

  SERVICES=(
    "smarthome-backend:php artisan serve --host=0.0.0.0 --port=8000:backend:SmartHome Laravel Backend"
    "smarthome-mqtt:php artisan mqtt:subscribe:backend:SmartHome MQTT Subscriber"
    "smarthome-reverb:php artisan reverb:start:backend:SmartHome Reverb WebSocket"
    "smarthome-queue:php artisan queue:work --sleep=3 --tries=3:backend:SmartHome Queue Worker"
    "smarthome-scheduler:php artisan schedule:work:backend:SmartHome Task Scheduler"
    "smarthome-frontend:npm start -- --port 3000:frontend:SmartHome Next.js Frontend"
  )

  for entry in "${SERVICES[@]}"; do
    IFS=':' read -r name cmd subdir desc <<< "$entry"
    workdir="$REPO_DIR/$subdir"
    bin="$PHP"
    [ "$cmd" = "npm"* ] && bin="$NPM"

    cat > "/etc/systemd/system/${name}.service" << EOF
[Unit]
Description=${desc}
After=network.target postgresql.service mosquitto.service

[Service]
WorkingDirectory=${workdir}
ExecStart=/usr/bin/${cmd}
Restart=always
RestartSec=5
User=${PI_USER}
Environment=HOME=/home/${PI_USER}

[Install]
WantedBy=multi-user.target
EOF
    systemctl enable "$name"
    info "Service ${name} eingerichtet"
  done

  systemctl daemon-reload

  # Mosquitto konfigurieren
  if [ ! -f /etc/mosquitto/conf.d/smarthome.conf ]; then
    echo -e "listener 1883 0.0.0.0\nallow_anonymous true" \
      > /etc/mosquitto/conf.d/smarthome.conf
    systemctl restart mosquitto
    info "Mosquitto konfiguriert"
  fi

  info "Ersteinrichtung abgeschlossen – starte Services..."
fi

# =============================================================================
# 5. Services neu starten
# =============================================================================
section "5. Services neu starten"

RESTART_SERVICES=(
  smarthome-backend
  smarthome-mqtt
  smarthome-reverb
  smarthome-queue
  smarthome-scheduler
  smarthome-frontend
)

for svc in "${RESTART_SERVICES[@]}"; do
  if systemctl is-enabled "$svc" &>/dev/null; then
    systemctl restart "$svc"
    info "${svc} neu gestartet"
  else
    warn "${svc} nicht gefunden – übersprungen (--setup ausführen)"
  fi
done

# =============================================================================
# Fertig
# =============================================================================
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Deploy abgeschlossen!                ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════╝${NC}"
echo ""
echo "  Dashboard:  http://$(hostname -I | awk '{print $1}'):3000"
echo "  API:        http://$(hostname -I | awk '{print $1}'):8000"
echo "  Reverb:     ws://$(hostname -I | awk '{print $1}'):8080"
echo ""

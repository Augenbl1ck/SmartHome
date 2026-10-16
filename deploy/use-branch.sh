#!/bin/bash
# Branch festlegen, den der Pi beim Update lädt, und sofort umschalten.
# Aufruf:
#   bash ~/SmartHome/deploy/use-branch.sh master
#   bash ~/SmartHome/deploy/use-branch.sh design/ha-ui
# Nach dem ersten Update auch:
#   bash ~/.local/bin/smarthome-branch master

set -euo pipefail

INSTALL_DIR="${SMARTHOME_DIR:-$HOME/SmartHome}"
BRANCH="${1:-}"

if [ -z "$BRANCH" ]; then
  echo "Aufruf: bash ~/SmartHome/deploy/use-branch.sh master"
  echo "        bash ~/SmartHome/deploy/use-branch.sh design/ha-ui"
  if [ -f "$HOME/.config/smarthome/branch" ]; then
    echo "Aktuell gewählt: $(tr -d '[:space:]' < "$HOME/.config/smarthome/branch")"
  fi
  exit 1
fi

if [ "$BRANCH" = "main" ]; then
  echo "Der stabile Branch heißt master."
  BRANCH=master
fi

if ! [[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]]; then
  echo "Ungültiger Branch-Name: $BRANCH"
  exit 1
fi

mkdir -p "$HOME/.config/smarthome"
printf '%s\n' "$BRANCH" > "$HOME/.config/smarthome/branch"
echo "Pi lädt ab jetzt: $BRANCH"

cd "$INSTALL_DIR"
git fetch origin "$BRANCH"
git checkout -- deploy/start-kiosk.sh deploy/update.sh deploy/smarthome-kiosk.desktop deploy/run-backend.sh 2>/dev/null || true
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Lokale Änderungen blockieren den Wechsel:"
  git status --short
  exit 1
fi
git checkout "$BRANCH"

exec bash "$INSTALL_DIR/deploy/update.sh"

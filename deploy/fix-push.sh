#!/bin/bash
# Fixe Push-Notification-Konfiguration und deploye Updates auf dem Pi

set -e

cd ~/SmartHome

echo "📥 Hole neueste Änderungen..."
git pull

echo ""
echo "📝 Lese VAPID Keys aus Backend..."
VAPID_PUB=$(grep "^VAPID_PUBLIC_KEY=" backend/.env | cut -d'=' -f2)
VAPID_PRIV=$(grep "^VAPID_PRIVATE_KEY=" backend/.env | cut -d'=' -f2)

if [ -z "$VAPID_PUB" ] || [ -z "$VAPID_PRIV" ]; then
  echo "❌ VAPID Keys nicht in backend/.env gefunden!"
  echo ""
  echo "🔧 Generiere neue VAPID Keys..."
  cd backend
  php artisan config:clear
  # Hier könnte man VAPID-Keys generieren, aber das sollte bereits geschehen sein
  echo "⚠️  Bitte VAPID Keys manuell in backend/.env setzen!"
  exit 1
fi

echo "✅ VAPID Keys gefunden"

echo ""
echo "📝 Aktualisiere frontend/.env.local..."

# Erstelle oder aktualisiere .env.local
cat > frontend/.env.local <<EOF
# API URLs (relativ für Nginx-Proxy)
NEXT_PUBLIC_API_URL=/api/v1
API_URL=http://127.0.0.1:8000/api/v1

# OpenWeatherMap API Key
NEXT_PUBLIC_WEATHER_API_KEY=a9fbbe7975b1f0ec04c36f83a1ce3ff1

# Laravel Reverb WebSocket (wird dynamisch per window.location angepasst)
NEXT_PUBLIC_REVERB_APP_KEY=c1nkf5n5ytpchkt38qwd
NEXT_PUBLIC_REVERB_HOST=smarthome.local

# Push Notifications (VAPID)
NEXT_PUBLIC_VAPID_PUBLIC_KEY=${VAPID_PUB}
EOF

# Backend-Key spiegeln (SSR/Proxy), falls noch nicht gesetzt
if ! grep -q "^WEATHER_API_KEY=" backend/.env 2>/dev/null; then
  echo "WEATHER_API_KEY=a9fbbe7975b1f0ec04c36f83a1ce3ff1" >> backend/.env
  echo "✅ WEATHER_API_KEY in backend/.env ergänzt"
elif grep -q '^WEATHER_API_KEY=$' backend/.env 2>/dev/null; then
  sed -i 's/^WEATHER_API_KEY=.*/WEATHER_API_KEY=a9fbbe7975b1f0ec04c36f83a1ce3ff1/' backend/.env
  echo "✅ WEATHER_API_KEY in backend/.env gesetzt"
fi

echo "✅ frontend/.env.local aktualisiert"

echo ""
echo "🔧 Cleane Backend-Config-Cache..."
cd ~/SmartHome/backend
php artisan config:clear
php artisan cache:clear
php artisan route:clear

echo ""
echo "📦 Installiere Backend-Dependencies..."
composer install --no-interaction --prefer-dist --optimize-autoloader

echo ""
echo "🔨 Baue Frontend neu..."
cd ~/SmartHome/frontend
npm install
npm run build

echo ""
echo "🔄 Starte Services neu..."
sudo systemctl restart smarthome-backend
sudo systemctl restart smarthome-frontend

echo ""
echo "✅ Deployment abgeschlossen!"
echo ""
echo "📍 Teste jetzt:"
echo "   - Lokal:    http://smarthome.local"
echo "   - Tailscale: https://smarthome.taile4b6ab.ts.net"
echo "   - System-Status in Einstellungen → System"
echo ""
echo "🐛 Bei Problemen:"
echo "   - Prüfe Browser-Console auf Fehler"
echo "   - Führe aus: bash ~/SmartHome/deploy/show-backend-logs.sh"


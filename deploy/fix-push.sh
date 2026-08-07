#!/bin/bash
# Fixe Push-Notification-Konfiguration auf dem Pi

set -e

cd ~/SmartHome

echo "📝 Lese VAPID Public Key aus Backend..."
VAPID_PUB=$(grep "^VAPID_PUBLIC_KEY=" backend/.env | cut -d'=' -f2)

if [ -z "$VAPID_PUB" ]; then
  echo "❌ VAPID_PUBLIC_KEY nicht in backend/.env gefunden!"
  exit 1
fi

echo "✅ VAPID Public Key gefunden: ${VAPID_PUB:0:50}..."

echo ""
echo "📝 Aktualisiere frontend/.env.local..."

# Erstelle oder aktualisiere .env.local
cat > frontend/.env.local <<EOF
# API URLs (relativ für Nginx-Proxy)
NEXT_PUBLIC_API_URL=/api/v1
API_URL=http://127.0.0.1:8000/api/v1

# OpenWeatherMap API Key
NEXT_PUBLIC_WEATHER_API_KEY=a9fbbe7975b1f0ec04c36f83a1ce3ff1

# Laravel Reverb WebSocket
NEXT_PUBLIC_REVERB_APP_KEY=c1nkf5n5ytpchkt38qwd
NEXT_PUBLIC_REVERB_HOST=smarthome.local
NEXT_PUBLIC_REVERB_PORT=80
NEXT_PUBLIC_REVERB_SCHEME=http

# Push Notifications (VAPID)
NEXT_PUBLIC_VAPID_PUBLIC_KEY=${VAPID_PUB}
EOF

echo "✅ frontend/.env.local aktualisiert"

echo ""
echo "🔨 Baue Frontend neu..."
cd frontend
npm run build

echo ""
echo "🔄 Starte Frontend-Service neu..."
sudo systemctl restart smarthome-frontend

echo ""
echo "✅ Push-Benachrichtigungen sollten jetzt funktionieren!"
echo ""
echo "📍 Teste jetzt:"
echo "   1. Öffne https://smarthome.taile4b6ab.ts.net"
echo "   2. Drücke F12 → Console"
echo "   3. Gehe zu Einstellungen → Benachrichtigungen"
echo "   4. Klicke 'Aktivieren' (Browser fragt nach Berechtigung)"
echo "   5. Klicke 'Test senden'"
echo ""
echo "🐛 Bei Problemen in der Browser-Konsole nach Fehlern suchen!"

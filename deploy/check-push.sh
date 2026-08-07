#!/bin/bash
# Prüfe Push-Notification-Konfiguration

echo "🔍 Prüfe Backend .env..."
if grep -q "VAPID_PUBLIC_KEY" ~/SmartHome/backend/.env; then
  echo "✅ Backend VAPID_PUBLIC_KEY: $(grep VAPID_PUBLIC_KEY ~/SmartHome/backend/.env | head -1)"
else
  echo "❌ Backend VAPID_PUBLIC_KEY fehlt!"
fi

echo ""
echo "🔍 Prüfe Frontend .env.local..."
if [ -f ~/SmartHome/frontend/.env.local ]; then
  if grep -q "NEXT_PUBLIC_VAPID_PUBLIC_KEY" ~/SmartHome/frontend/.env.local; then
    echo "✅ Frontend NEXT_PUBLIC_VAPID_PUBLIC_KEY: $(grep NEXT_PUBLIC_VAPID_PUBLIC_KEY ~/SmartHome/frontend/.env.local)"
  else
    echo "❌ Frontend NEXT_PUBLIC_VAPID_PUBLIC_KEY fehlt!"
  fi
else
  echo "❌ Frontend .env.local existiert nicht!"
fi

echo ""
echo "🔍 Prüfe Service Worker..."
if [ -f ~/SmartHome/frontend/public/sw.js ]; then
  echo "✅ Service Worker existiert"
else
  echo "❌ Service Worker fehlt!"
fi

echo ""
echo "🔍 Öffne Browser-Konsole und prüfe:"
echo "   - navigator.serviceWorker.controller (sollte gesetzt sein)"
echo "   - Notification.permission (sollte 'granted' oder 'default' sein)"
echo "   - console nach Fehlern durchsuchen"

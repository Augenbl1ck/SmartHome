#!/bin/bash
# HTTPS-Setup für Tailscale-Zugriff

set -e

echo "🔐 Verschiebe Tailscale-Zertifikate..."
sudo mkdir -p /etc/ssl/certs /etc/ssl/private
sudo mv ~/SmartHome/frontend/smarthome.taile4b6ab.ts.net.crt /etc/ssl/certs/ 2>/dev/null || true
sudo mv ~/SmartHome/frontend/smarthome.taile4b6ab.ts.net.key /etc/ssl/private/ 2>/dev/null || true
sudo chmod 600 /etc/ssl/private/smarthome.taile4b6ab.ts.net.key

echo "📝 Aktualisiere nginx-Konfiguration..."
sudo cp ~/SmartHome/deploy/smarthome-nginx.conf /etc/nginx/sites-available/smarthome

echo "✅ Teste nginx-Konfiguration..."
sudo nginx -t

echo "🔄 Lade nginx neu..."
sudo systemctl reload nginx

echo ""
echo "✅ HTTPS ist aktiv!"
echo ""
echo "📍 Lokaler Zugriff (HTTP):    http://smarthome.local"
echo "🌐 Tailscale-Zugriff (HTTPS): https://smarthome.taile4b6ab.ts.net"
echo ""
echo "🔔 Push-Benachrichtigungen aktivieren:"
echo "   1. Öffne https://smarthome.taile4b6ab.ts.net (mit Tailscale)"
echo "   2. Gehe zu Einstellungen → Benachrichtigungen"
echo "   3. Klicke 'Aktivieren'"
echo "   4. Danach funktionieren Push-Benachrichtigungen auch über HTTP!"

#!/bin/bash
# Zeige die letzten Backend-Logs für Fehlersuche

echo "📋 Letzte 50 Zeilen aus Laravel Log:"
echo "=================================="
tail -50 ~/SmartHome/backend/storage/logs/laravel.log

echo ""
echo ""
echo "📋 Systemd Service Status:"
echo "=================================="
systemctl status smarthome-backend --no-pager -l | tail -20

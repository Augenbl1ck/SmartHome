# SmartHome — Pi Deployment Checkliste
# Repo: https://github.com/Augenbl1ck/SmartHome

## 1. Repo auf den Pi klonen

```bash
cd ~
git clone git@github.com:Augenbl1ck/SmartHome.git SmartHome
cd SmartHome
```

## 2. Setup-Script ausführen (installiert alles automatisch)

```bash
bash deploy/setup-pi.sh
```

Das Script installiert: Node.js 20, PHP, Composer, BLE-Libs, Abhängigkeiten,
führt Migrationen durch und startet alle systemd-Services.

## 3. Frontend bauen (einmalig + nach jedem Update)

```bash
cd ~/SmartHome/frontend
npm install
npm run build
```

## 4. Umgebungsvariablen setzen

Datei `backend/.env` anpassen:
```
APP_ENV=production
APP_KEY=         # php artisan key:generate
BLE_BRIDGE_URL=http://localhost:3001
```

Datei `frontend/.env.local` erstellen:
```
NEXT_PUBLIC_API_URL=http://<PI-IP>/api/v1
NEXT_PUBLIC_WEATHER_API_KEY=a9fbbe7975b1f0ec04c36f83a1ce3ff1
```

## 5. nginx installieren (einmalig)

```bash
sudo apt-get install -y nginx
sudo cp ~/SmartHome/deploy/smarthome-nginx.conf /etc/nginx/sites-available/smarthome
sudo ln -s /etc/nginx/sites-available/smarthome /etc/nginx/sites-enabled/smarthome
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl enable nginx && sudo systemctl restart nginx
```

→ App erreichbar unter: http://<PI-IP>  (Port 80, kein :3000 nötig)

## 6. Services verwalten

```bash
# Status aller Services
sudo systemctl status smarthome-*

# Neu starten nach Update
sudo systemctl restart smarthome-backend smarthome-frontend

# Logs ansehen
journalctl -u smarthome-ble-bridge -f
journalctl -u smarthome-backend -f
```

## 7. Update einspielen

```bash
cd ~/SmartHome
git pull
cd backend  && composer install --no-dev && php artisan migrate --force
cd ../frontend && npm run build
sudo systemctl restart smarthome-backend smarthome-frontend
```

---

## Mobil-Test (Windows, selbes WLAN)

1. `ipconfig` → IPv4-Adresse notieren (z.B. 192.168.1.50)
2. Next.js Dev-Server läuft bereits auf 0.0.0.0 (`npm run dev`)
3. Laravel: `php artisan serve --host=0.0.0.0 --port=8000`
4. Im Handy-Browser: `http://192.168.1.50:3000`
5. Deine aktuelle Windows-IP: **172.31.156.9**

> Hinweis: CORS und API_URL müssen ggf. angepasst werden wenn vom Handy aus
> auf das Backend zugegriffen wird (NEXT_PUBLIC_API_URL auf die Windows-IP setzen).

# SmartHome

Selbst gehostetes Smart-Home-System — kein Home Assistant, keine Hersteller-Cloud.

---

## Todo

### 🔴 Dringend (fehlt noch / nicht deployed)
- [ ] Zigbee-Sektion + ZigbeeController auf Pi deployen (Frontend neu bauen nach letztem Push)
- [ ] Reverb WebSocket konfigurieren — App Key in `backend/.env` + `frontend/.env.local` setzen, damit Live-Updates funktionieren

### 🟡 Sicherheit
- [ ] `permit_join: false` als Standard in `/opt/zigbee2mqtt/data/configuration.yaml` (Pairing nur manuell über UI)
- [ ] Reverb App Secret absichern (zufälligen Key generieren statt leerem Wert)

### 🟢 Komfort
- [ ] Update-Script (`deploy/update.sh`) — ein Befehl: git pull + composer + frontend build + services restart
- [ ] Automatisches SQLite-Backup per Cron (täglich nach `/home/pi/backups/`)
- [ ] Externer Zugriff via Tailscale (VPN, kein Port-Forwarding nötig)

---

## Architektur

```
Next.js Frontend
      │  REST API / WebSocket
Laravel Backend
      │  MQTT
   Mosquitto
      │
 ┌────┴────┐
Zigbee2MQTT  Shelly / ESP32
      │
  Zigbee USB
      │
  Zigbee-Geräte
(Steckdosen, Thermostate, Sensoren)
```

**Prinzip:**
- Geräte kommunizieren ausschließlich über MQTT
- Laravel enthält die gesamte Logik
- Das Frontend kommuniziert nur mit Laravel, nie direkt mit Geräten
- Alle Daten bleiben lokal auf dem Raspberry Pi

---

## Stack

| Schicht | Technologie |
|---|---|
| Frontend | Next.js (App Router, TypeScript, Tailwind v4, shadcn/ui) |
| Backend | Laravel 11 (PHP 8.2, REST API, MQTT) |
| Datenbank | SQLite (Entwicklung) → PostgreSQL (Pi) |
| Broker | Mosquitto |
| Zigbee | Zigbee2MQTT + SONOFF ZBDongle-P |
| Hub | Raspberry Pi |

---

## Projektstruktur

```
SmartHome/
├── frontend/       Next.js App
├── backend/        Laravel API
├── ble-bridge/     Node.js Daemon für Bluetooth-Shellys
└── tools/          Hilfsskripte (sensor-sim etc.)
```

---

## Lokale Entwicklung

### Voraussetzungen

- PHP 8.2 (`C:\php82\php.exe`)
- Node.js 20+
- Mosquitto (installiert via winget: `winget install EclipseFoundation.Mosquitto`)

### Starten – VS Code (empfohlen)

`Ctrl+Shift+B` startet alle Dienste gleichzeitig als separate Terminal-Tabs in VS Code.

Alternativ über `Ctrl+Shift+P` → **Tasks: Run Task**:

| Task | Startet |
|---|---|
| `SmartHome: Alles starten` | Alle Dienste |
| `SmartHome: Ohne BLE & Sim` | Nur Mosquitto, Backend, MQTT Subscriber, Frontend |
| `Mosquitto` | Nur MQTT-Broker |
| `Backend` | Nur Laravel |
| `MQTT Subscriber` | Nur Subscriber-Daemon |
| `BLE Bridge` | Nur BLE-Bridge |
| `Frontend` | Nur Next.js |
| `Sensor Sim` | Nur Sensor-Simulation |

### Starten – manuell (PowerShell)

```powershell
.\start.ps1              # Alles
.\start.ps1 -NoBle       # ohne BLE Bridge
.\start.ps1 -NoSim       # ohne Sensor-Simulation
```

### Dienste & URLs

| Dienst | URL / Port |
|---|---|
| Frontend | http://localhost:3000 |
| Backend | http://localhost:8000 |
| BLE Bridge | http://localhost:3001 |
| Mosquitto | Port 1883 |

---

## Raspberry Pi Setup

### 1. Grundpakete

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git mosquitto mosquitto-clients

# PHP 8.2 (nicht im Standard-Repo)
sudo apt install -y lsb-release ca-certificates curl
sudo curl -sSLo /usr/share/keyrings/deb.sury.org-php.gpg https://packages.sury.org/php/apt.gpg
echo "deb [signed-by=/usr/share/keyrings/deb.sury.org-php.gpg] https://packages.sury.org/php/ $(lsb_release -sc) main" \
  | sudo tee /etc/apt/sources.list.d/php.list
sudo apt update
sudo apt install -y php8.2 php8.2-sqlite3 php8.2-pgsql php8.2-mbstring php8.2-xml php8.2-curl

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Composer
curl -sS https://getcomposer.org/installer | php
sudo mv composer.phar /usr/local/bin/composer
```

### 2. Repository klonen

```bash
git clone git@github.com:Augenbl1ck/SmartHome.git
cd SmartHome
```

### 3. Fehlende Dateien anlegen (gitignored)

**`backend/.env`**
```env
APP_KEY=           # wird durch key:generate gesetzt
APP_URL=http://<PI-IP>:8000

# Datenbank (PostgreSQL)
DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_PORT=5432
DB_DATABASE=smarthome
DB_USERNAME=smarthome
DB_PASSWORD=geheimesPasswort

# MQTT
MQTT_HOST=127.0.0.1
MQTT_PORT=1883

# Reverb WebSocket
BROADCAST_CONNECTION=reverb
REVERB_APP_ID=<zufällig>
REVERB_APP_KEY=<zufällig>
REVERB_APP_SECRET=<zufällig>
REVERB_HOST=<PI-IP>
REVERB_PORT=8080
REVERB_SCHEME=http
```

**`frontend/.env.local`**
```env
NEXT_PUBLIC_API_URL=http://<PI-IP>:8000/api/v1
NEXT_PUBLIC_WEATHER_API_KEY=<key>
NEXT_PUBLIC_REVERB_APP_KEY=<gleicher Wert wie REVERB_APP_KEY>
NEXT_PUBLIC_REVERB_HOST=<PI-IP>
NEXT_PUBLIC_REVERB_PORT=8080
NEXT_PUBLIC_REVERB_SCHEME=http
```

### 4. Dependencies installieren

```bash
cd backend   && composer install && php artisan key:generate && php artisan migrate --seed
cd ../frontend   && npm install
cd ../ble-bridge && npm install
```

### 5. PostgreSQL einrichten

```bash
sudo apt install -y postgresql postgresql-client
sudo systemctl enable postgresql
sudo systemctl start postgresql

# Datenbank und Nutzer anlegen
sudo -u postgres psql << 'SQL'
CREATE USER smarthome WITH PASSWORD 'geheimesPasswort';
CREATE DATABASE smarthome OWNER smarthome;
SQL

# Migrations ausführen
cd ~/SmartHome/backend
php artisan migrate
```

### 6. Mosquitto konfigurieren

```bash
echo -e "listener 1883 0.0.0.0\nallow_anonymous true" | sudo tee -a /etc/mosquitto/mosquitto.conf
sudo systemctl enable mosquitto
sudo systemctl restart mosquitto
```

### 6. Zigbee2MQTT installieren

```bash
sudo npm install -g zigbee2mqtt

mkdir -p ~/.config/zigbee2mqtt
cat > ~/.config/zigbee2mqtt/configuration.yaml << 'EOF'
homeassistant: false
permit_join: true
mqtt:
  base_topic: zigbee2mqtt
  server: mqtt://localhost:1883
serial:
  port: /dev/ttyUSB0
EOF

zigbee2mqtt
```

### 7. Chromium Kiosk + virtuelle Tastatur

Der SmartHome-Browser startet automatisch beim Desktop-Login über `deploy/start-kiosk.sh` (Autostart-`.desktop`).

```bash
mkdir -p ~/.config/autostart
cp ~/SmartHome/deploy/smarthome-kiosk.desktop ~/.config/autostart/
chmod +x ~/SmartHome/deploy/start-kiosk.sh
```

Oder beim ersten Setup / Update automatisch via `setup-pi.sh` bzw. `update.sh`.

**Wichtig (Squeekboard):** Echtes Chromium-`--kiosk` / Fullscreen legt das Fenster *über* die Bildschirmtastatur (Wayland-Layer). Deshalb startet das Skript Chromium als **App-Fenster maximiert** (`--app` + `--start-maximized`) — optisch voller Screen, aber Squeekboard bleibt sichtbar. Die App selbst aktiviert den UI-Kiosk über `?kiosk=1`.

---

### 8. Autostart (systemd)

Beispiel für das Backend — analog für `mqtt:subscribe`, Frontend und BLE Bridge anlegen:

```bash
sudo nano /etc/systemd/system/smarthome-backend.service
```

```ini
[Unit]
Description=SmartHome Laravel Backend
After=network.target

[Service]
WorkingDirectory=/home/pi/SmartHome/backend
ExecStart=/usr/bin/php artisan serve --host=0.0.0.0 --port=8000
Restart=always
User=pi

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable smarthome-backend
sudo systemctl start smarthome-backend
```

---

## Gerät hinzufügen

### Zigbee-Gerät (Zigbee2MQTT)

1. Zigbee2MQTT starten und `permit_join: true` setzen
2. Gerät anlernen (Knopf drücken)
3. Friendly Name notieren (z. B. `Wohnzimmer Steckdose`)
4. In Settings → Gerät anlegen:
   - **Protokoll**: `zigbee2mqtt`
   - **MQTT Topic**: `zigbee2mqtt/Wohnzimmer Steckdose`

### Shelly Gen3 (MQTT)

1. Shelly App → Einstellungen → MQTT aktivieren
   - Server: Pi-IP, Port: `1883`
2. Device-ID notieren (z. B. `shellyplugsg3-A1B2C3`)
3. In Settings → Gerät anlegen:
   - **Protokoll**: `shelly_gen3`
   - **MQTT Topic**: `shellyplugsg3-A1B2C3`

### ESP32 / Eigene Geräte

Topic frei wählbar, z. B. `home/wohnzimmer/licht`.
- **Protokoll**: `simple`
- **MQTT Topic**: `home/wohnzimmer/licht`

---

## MQTT-Topics

| Protokoll | Subscriber hört auf | Backend sendet an |
|---|---|---|
| `shelly_gen3` | `<topic>/status/switch:0` | `<topic>/rpc` (JSON-RPC) |
| `zigbee2mqtt` | `zigbee2mqtt/<name>` | `zigbee2mqtt/<name>/set` |
| `simple` | `<topic>` | `<topic>` |

---

## MQTT-Subscriber

Empfängt Status-Updates aller Geräte und schreibt sie in die Datenbank:

```bash
php artisan mqtt:subscribe
```

Muss dauerhaft laufen (systemd-Service oder separates Terminal).

---

## Um Pi zu aktualisieren nach Änderung

```bash
bash ~/SmartHome/deploy/update.sh
```

---

## Hardware-Empfehlungen

| Kategorie | Empfehlung |
|---|---|
| Zigbee Coordinator | SONOFF ZBDongle-P + 50 cm USB-Verlängerung |
| Steckdosen | NOUS A1Z oder SONOFF S60 Zigbee |
| Thermostat | SONOFF TRVZB |
| Temperatursensor | SONOFF SNZB-02P |
| Tür/Fensterkontakt | SONOFF SNZB-04P |
| Eigene Geräte | ESP32 mit MQTT |

# SmartHome

Selbst gehostetes Smart-Home-System mit Next.js Frontend, Laravel Backend und MQTT für die Gerätekommunikation. Deployment-Ziel: Raspberry Pi.

---

## Technologie-Stack

| Schicht | Technologie |
|---|---|
| Frontend | Next.js 15 (App Router, Server Components, TypeScript, Tailwind v4, shadcn/ui) |
| Backend | Laravel 11 (PHP 8.5, REST API, php-mqtt/client) |
| Broker | Mosquitto MQTT |
| Datenbank | SQLite (lokal) → PostgreSQL (Raspberry Pi) |
| Deployment | Docker Compose |
| Geräte | Shelly Gen1/Gen2/Gen3, generische MQTT-Geräte |

---

## Projektstruktur

```
SmartHome/
├── frontend/          # Next.js App
├── backend/           # Laravel API
└── docker/            # Docker Compose (Mosquitto + PostgreSQL)
    └── mosquitto/
        └── config/
```

---

## Lokale Entwicklung starten

```bash
# Backend
cd backend
C:\php82\php.exe artisan serve        # läuft auf http://localhost:8000

# Frontend
cd frontend
npm run dev                           # läuft auf http://localhost:3000
```

---

## Roadmap

### ✅ Phase 1 – Grundstruktur (abgeschlossen)

- [x] Projektstruktur anlegen (Frontend / Backend / Docker)
- [x] Next.js 15 mit App Router, TypeScript, Tailwind v4, Turbopack
- [x] shadcn/ui einrichten (Radix/Nova, Komponenten)
- [x] Laravel 11 Backend mit PHP 8.5
- [x] php-mqtt/client installiert
- [x] Datenbankmigrationen (rooms, devices, automations, device_logs)
- [x] Eloquent-Models mit Beziehungen (Room → Device, Device → DeviceLog)
- [x] REST-API unter `/api/v1` (CRUD für Rooms, Devices, Automations)
- [x] CORS für Frontend konfiguriert
- [x] Demo-Seeder (3 Räume, 6 Geräte, 2 Automationen)
- [x] Zustand-Store + typisierter API-Client (`api.ts`)
- [x] Geräte-Hilfsfunktionen (`deviceIcons`, `deviceLabels`, `isToggleable`)
- [x] Dashboard (Räume-Übersicht, aktive Geräte, Temperatursensoren)
- [x] Raum-Detailseite mit Geräte-Karten
- [x] Automationen-Seite (Liste, Toggle aktiv/inaktiv)
- [x] Einstellungen (Geräte & Räume erstellen, bearbeiten, löschen)
- [x] Server Components: Daten werden serverseitig geladen (kein Lade-Flicker)
- [x] Optimistisches Toggle (Switch reagiert sofort, kein Warten auf API)
- [x] Race-Condition-Fix (kein Doppel-Toggle-Echo bei schnellen Klicks)
- [x] MQTT-Protokoll-Unterstützung: Einfach / Shelly Gen3 (RPC) / Shelly Gen1
- [x] Docker Compose für Mosquitto + PostgreSQL (Raspberry Pi)
- [x] Git-Repository auf GitHub gepusht

---

### 🔲 Phase 2 – Echte Geräte-Kommunikation

- [ ] **Mosquitto-Broker lokal starten**
  ```bash
  cd docker
  docker compose up -d mosquitto
  ```
- [ ] Shelly-Gerät in der Shelly App auf MQTT zeigen lassen (IP des Rechners, Port 1883)
- [ ] Verbindung testen: Toggle im Dashboard → Steckdose schaltet sich wirklich
- [ ] **MQTT-Subscriber im Backend** (Laravel Command / Daemon)
  - Lauscht auf `shellygen3/+/status/switch:0` und ähnliche Topics
  - Schreibt empfangenen Status in die Datenbank (`device_logs`, `devices.status`)
  - Damit wird auch erkannt, wenn jemand den physischen Schalter drückt
- [ ] Basis-Topic und Status-Topic pro Gerät konfigurierbar machen

---

### 🔲 Phase 3 – Echtzeit-Updates im Dashboard

- [ ] **Server-Sent Events (SSE) oder WebSocket** im Laravel Backend einrichten
  - Option A: Laravel Reverb (nativer WebSocket-Server)
  - Option B: SSE-Endpoint der gepollten Status-Änderungen schickt
- [ ] Frontend lauscht auf Events und aktualisiert die Gerätekarten live
  - Wenn jemand eine Lampe manuell schaltet → Dashboard aktualisiert sich automatisch
- [ ] Verbindungsstatus-Anzeige im Header (online / offline / reconnecting)

---

### 🔲 Phase 4 – Automationen

- [ ] Automations-Engine im Backend
  - **Zeitbasiert** (z.B. „Licht um 22:00 ausschalten")
  - **Sensorbasiert** (z.B. „Wenn Bewegungsmelder aktiv → Flurlampe an")
  - **Statusbasiert** (z.B. „Wenn Steckdose an > 2h → Benachrichtigung")
- [ ] Laravel Scheduler konfigurieren (`artisan schedule:run`)
- [ ] Automationen-UI erweitern: Trigger und Aktion visuell erstellen (kein JSON-Editor)
- [ ] Ausführungslog anzeigen (wann wurde welche Automation ausgelöst)

---

### 🔲 Phase 5 – Sensor-Daten & Verlauf

- [ ] Temperatur- / Feuchtigkeitssensor-Daten automatisch in `device_logs` speichern
- [ ] Verlaufsdiagramme auf der Geräte-Detailseite (z.B. Temperaturkurve der letzten 24h)
- [ ] Bibliothek: Recharts oder Chart.js
- [ ] Alte Logs automatisch bereinigen (Einstellung: Aufbewahrungsdauer)

---

### 🔲 Phase 6 – Raspberry Pi Deployment

- [ ] **Raspberry Pi einrichten**
  - Raspberry Pi OS Lite (64-bit) installieren
  - SSH aktivieren, feste IP-Adresse vergeben
- [ ] **Docker & Docker Compose auf Pi installieren**
  ```bash
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker pi
  ```
- [ ] **Datenbank von SQLite auf PostgreSQL umstellen**
  - `.env` auf Pi anpassen (`DB_CONNECTION=pgsql`, Zugangsdaten aus docker-compose.yml)
  - Migration + Seeder auf PostgreSQL ausführen
- [ ] **Docker Stack auf Pi deployen**
  ```bash
  docker compose up -d        # Mosquitto + PostgreSQL
  ```
- [ ] **Laravel auf Pi deployen**
  - PHP 8.3 + Composer auf Pi installieren oder per Docker
  - `.env` anpassen (APP_URL, DB, MQTT)
- [ ] **Next.js auf Pi deployen**
  - `npm run build` → `npm start` (oder per PM2)
  - Alternativ: Docker-Image für Frontend
- [ ] **Nginx als Reverse Proxy**
  - Frontend: Port 80 → Next.js (3000)
  - Backend: `/api` → Laravel (8000)
- [ ] **SSL-Zertifikat** (optional, für Zugriff von außen)
  - Certbot + Let's Encrypt (braucht Domain oder DynDNS)
  - Oder: selbstsigniertes Zertifikat für Heimnetz
- [ ] **Autostart** beim Pi-Neustart sicherstellen
  - Docker-Dienste: `restart: unless-stopped` (bereits gesetzt)
  - Laravel + Next.js: PM2 oder systemd-Service

---

### 🔲 Phase 7 – Sicherheit & Authentifizierung

- [ ] Login-Seite (E-Mail + Passwort)
- [ ] Laravel Sanctum für API-Authentifizierung
- [ ] Geschützte API-Endpunkte (kein öffentlicher Zugriff)
- [ ] MQTT-Broker absichern (Benutzername + Passwort in `mosquitto.conf`)
- [ ] Umgebungsvariablen aus dem Repository heraushalten (`.env` in `.gitignore`)

---

### 🔲 Phase 8 – Feinschliff & Mobile

- [ ] PWA-Manifest (auf Handy installierbar wie eine native App)
- [ ] Dark/Light Mode Umschalter
- [ ] Push-Benachrichtigungen (z.B. „Bewegung erkannt")
- [ ] Geräte-Gruppen oder Szenen (mehrere Geräte mit einem Klick schalten)
- [ ] Favoriten / Schnellzugriff auf häufig genutzte Geräte

---

## Raspberry Pi Ersteinrichtung

### 1. Grundpakete installieren

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git nodejs npm php8.2 php8.2-sqlite3 php8.2-mbstring php8.2-xml php8.2-curl mosquitto mosquitto-clients
```

**Composer installieren:**
```bash
curl -sS https://getcomposer.org/installer | php
sudo mv composer.phar /usr/local/bin/composer
```

### 2. Repo klonen

```bash
cd ~
git clone git@github.com:Augenbl1ck/SmartHome.git
cd SmartHome
```

### 3. Was nach dem Clone fehlt (gitignored)

| Was | Wo | Befehl |
|---|---|---|
| `vendor/` | `backend/` | `composer install` |
| `node_modules/` | `frontend/` | `npm install` |
| `node_modules/` | `ble-bridge/` | `npm install` |
| `*.sqlite` | `backend/database/` | `php artisan migrate --seed` |
| `.env` | `backend/` | manuell anlegen (siehe unten) |
| `.env.local` | `frontend/` | manuell anlegen (siehe unten) |

### 4. Backend einrichten

```bash
cd ~/SmartHome/backend
cp .env.example .env
php artisan key:generate
php artisan migrate --seed
```

**`backend/.env` wichtige Werte:**
```env
APP_URL=http://localhost:8000
DB_CONNECTION=sqlite
MQTT_HOST=127.0.0.1
MQTT_PORT=1883
```

### 5. Frontend einrichten

```bash
cd ~/SmartHome/frontend
npm install
```

**`frontend/.env.local` anlegen:**
```env
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
OPENWEATHERMAP_API_KEY=<dein-key>
```

### 6. BLE Bridge einrichten

```bash
cd ~/SmartHome/ble-bridge
npm install
```

### 7. Mosquitto konfigurieren

```bash
sudo nano /etc/mosquitto/mosquitto.conf
```

Folgendes am Ende der Datei hinzufügen:
```
listener 1883 0.0.0.0
allow_anonymous true
```

```bash
sudo systemctl restart mosquitto
sudo systemctl enable mosquitto   # Autostart beim Booten
```

### 8. Shelly MQTT-Server anpassen

Da der Pi eine andere IP hat als Windows, muss im Shelly die MQTT-Server-IP auf die Pi-IP gesetzt werden:
- Shelly App → Einstellungen → MQTT → Server: `<Pi-IP>` (z.B. `192.168.178.x`)

### 9. Alles starten

```bash
# Backend
cd ~/SmartHome/backend
php artisan serve &

# BLE Bridge (falls Bluetooth-Geräte)
cd ~/SmartHome/ble-bridge
node index.js &

# Frontend
cd ~/SmartHome/frontend
npm run dev -- --hostname 0.0.0.0
```

> Für dauerhaften Betrieb empfiehlt sich PM2 (`npm install -g pm2`).

---

## Gerät hinzufügen (Shelly Plug S Gen3)

1. Shelly mit WLAN verbinden → Shelly App öffnen
2. *Einstellungen → MQTT → aktivieren*
   - Server: IP des Raspberry Pi (z.B. `192.168.1.100`)
   - Port: `1883`
3. Geräte-ID notieren (Einstellungen → Geräteinformationen → Device ID)  
   Beispiel: `shellyplugsg3-A1B2C3`
4. Im Dashboard → Einstellungen → Neues Gerät:
   - Typ: Steckdose
   - Protokoll: **Shelly Gen3 (RPC)**
   - MQTT Topic: `shellygen3/shellyplugsg3-A1B2C3`

---

## MQTT Topic-Schema

| Protokoll | Basis-Topic | Befehl geht an | Status kommt von |
|---|---|---|---|
| Shelly Gen3 | `shellygen3/<id>` | `<topic>/rpc` (JSON-RPC) | `<topic>/status/switch:0` |
| Shelly Gen1/2 | `shellies/<id>` | `<topic>/relay/0/command` | `<topic>/relay/0` |
| Einfach | `home/<raum>/<gerät>` | Topic direkt (`on`/`off`) | — |

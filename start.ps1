# SmartHome – Alles starten
# Aufruf: .\start.ps1
# Optional: .\start.ps1 -NoBle -NoSim

param(
    [switch]$NoBle,   # BLE Bridge nicht starten
    [switch]$NoSim    # Sensor-Simulation nicht starten
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Start-Window($title, $dir, $cmd) {
    Start-Process powershell -ArgumentList "-NoExit -Command `"Set-Location '$dir'; `$host.UI.RawUI.WindowTitle = '$title'; $cmd`""
}

Write-Host ""
Write-Host "  SmartHome wird gestartet..." -ForegroundColor Cyan
Write-Host ""

# 1. Mosquitto
Write-Host "  [1/5] Mosquitto MQTT-Broker..." -ForegroundColor Yellow
[System.IO.File]::WriteAllText("$env:TEMP\mqtt.conf", "listener 1883 0.0.0.0`nallow_anonymous true`n")
$running = Get-Process mosquitto -ErrorAction SilentlyContinue
if ($running) {
    Write-Host "        bereits aktiv (PID $($running.Id))" -ForegroundColor DarkGray
} else {
    Start-Process "C:\Program Files\mosquitto\mosquitto.exe" -ArgumentList "-c $env:TEMP\mqtt.conf" -NoNewWindow
    Start-Sleep 1
    $test = Test-NetConnection -ComputerName 127.0.0.1 -Port 1883 -WarningAction SilentlyContinue
    if ($test.TcpTestSucceeded) {
        Write-Host "        gestartet auf Port 1883" -ForegroundColor Green
    } else {
        Write-Host "        FEHLER: Port 1883 nicht erreichbar" -ForegroundColor Red
    }
}

# 2. Laravel Backend
Write-Host "  [2/5] Laravel Backend..." -ForegroundColor Yellow
Start-Window "Backend" "$root\backend" "C:\php82\php.exe artisan serve"
Start-Sleep 2
Write-Host "        http://localhost:8000" -ForegroundColor Green

# 3. MQTT Subscriber
Write-Host "  [3/5] MQTT Subscriber..." -ForegroundColor Yellow
Start-Window "MQTT Subscriber" "$root\backend" "C:\php82\php.exe artisan mqtt:subscribe"
Write-Host "        lauscht auf alle Topics" -ForegroundColor Green

# 4. BLE Bridge
if (-not $NoBle) {
    Write-Host "  [4/5] BLE Bridge..." -ForegroundColor Yellow
    Start-Window "BLE Bridge" "$root\ble-bridge" "node index.js"
    Write-Host "        http://localhost:3001" -ForegroundColor Green
} else {
    Write-Host "  [4/5] BLE Bridge übersprungen (-NoBle)" -ForegroundColor DarkGray
}

# 5. Frontend
Write-Host "  [5/5] Next.js Frontend..." -ForegroundColor Yellow
Start-Window "Frontend" "$root\frontend" "npm run dev -- --hostname 0.0.0.0"
Write-Host "        http://localhost:3000  (bereit in ~10s)" -ForegroundColor Green

# Sensor-Simulation
if (-not $NoSim) {
    Write-Host ""
    Write-Host "  [+]   Sensor-Simulation..." -ForegroundColor Yellow
    Start-Window "Sensor-Sim" "$root" "node tools\sensor-sim.js"
    Write-Host "        simuliert Temperatur-Updates" -ForegroundColor Green
}

Write-Host ""
Write-Host "  Alle Dienste gestartet." -ForegroundColor Cyan
Write-Host "  Dashboard: http://localhost:3000" -ForegroundColor White
Write-Host ""

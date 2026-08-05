# SmartHome – Alle Dienste stoppen
# Aufruf: .\stop.ps1

Write-Host ""
Write-Host "  SmartHome wird gestoppt..." -ForegroundColor Cyan
Write-Host ""

$stopped = 0

function Stop-Named($name, $processName) {
    $procs = Get-Process $processName -ErrorAction SilentlyContinue
    if ($procs) {
        $procs | Stop-Process -Force -ErrorAction SilentlyContinue
        Write-Host "  [OK] $name gestoppt" -ForegroundColor Green
        return $true
    } else {
        Write-Host "  [--] $name lief nicht" -ForegroundColor DarkGray
        return $false
    }
}

# Mosquitto
if (Stop-Named "Mosquitto" "mosquitto") { $stopped++ }

# PHP-Prozesse (Backend, MQTT Subscriber, Reverb, Queue Worker, Scheduler)
$phpProcs = Get-Process php -ErrorAction SilentlyContinue
if ($phpProcs) {
    $phpProcs | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Host "  [OK] PHP-Dienste gestoppt ($($phpProcs.Count) Prozesse: Backend, Subscriber, Reverb, Queue, Scheduler)" -ForegroundColor Green
    $stopped++
} else {
    Write-Host "  [--] Keine PHP-Prozesse aktiv" -ForegroundColor DarkGray
}

# Node.js (Frontend, BLE Bridge, Sensor-Sim)
$nodeProcs = Get-Process node -ErrorAction SilentlyContinue
if ($nodeProcs) {
    $nodeProcs | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Host "  [OK] Node.js-Dienste gestoppt ($($nodeProcs.Count) Prozesse: Frontend, BLE Bridge, Sensor-Sim)" -ForegroundColor Green
    $stopped++
} else {
    Write-Host "  [--] Keine Node.js-Prozesse aktiv" -ForegroundColor DarkGray
}

Write-Host ""
if ($stopped -gt 0) {
    Write-Host "  Alle Dienste gestoppt." -ForegroundColor Cyan
} else {
    Write-Host "  Keine Dienste waren aktiv." -ForegroundColor DarkGray
}
Write-Host ""

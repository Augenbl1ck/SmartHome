<?php

return [
    /*
     | URL des BLE Bridge Daemon (Node.js, läuft auf dem Raspberry Pi)
     | Auf dem Pi: http://localhost:3001
     | Für Remote-Tests: http://192.168.x.x:3001
     */
    'ble_bridge_url' => env('BLE_BRIDGE_URL', 'http://localhost:3001'),
];

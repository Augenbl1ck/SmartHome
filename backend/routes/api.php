<?php

use App\Http\Controllers\Api\PushController;
use App\Http\Controllers\Api\AutomationController;
use App\Http\Controllers\Api\AutomationLogController;
use App\Http\Controllers\Api\BleController;
use App\Http\Controllers\Api\DeviceController;
use App\Http\Controllers\Api\DeviceLogController;
use App\Http\Controllers\Api\DiscoverController;
use App\Http\Controllers\Api\MqttController;
use App\Http\Controllers\Api\RoomController;
use App\Http\Controllers\Api\SceneController;
use App\Http\Controllers\Api\ShellyRpcController;
use App\Http\Controllers\Api\CalendarController;
use App\Http\Controllers\Api\PanelSettingsController;
use App\Http\Controllers\Api\SystemController;
use App\Http\Controllers\Api\ZigbeeController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function () {
    Route::apiResource('rooms', RoomController::class);
    Route::apiResource('devices', DeviceController::class);
    Route::apiResource('automations', AutomationController::class);
    Route::get('automation-logs', [AutomationLogController::class, 'index']);
    Route::apiResource('scenes', SceneController::class);
    Route::post('scenes/{scene}/activate', [SceneController::class, 'activate']);

    Route::post('mqtt/publish', [MqttController::class, 'publish']);
    Route::post('devices/{device}/toggle', [MqttController::class, 'toggleDevice']);
    Route::post('devices/{device}/set-status', [DeviceController::class, 'setStatus']);
    Route::post('devices/{device}/thermostat', [DeviceController::class, 'thermostatCommand']);
    Route::get('devices/{device}/logs', [DeviceLogController::class, 'index']);
    Route::get('devices/{device}/sensor-history', [DeviceLogController::class, 'sensorHistory']);

    // BLE
    Route::get('ble/scan', [BleController::class, 'scan']);
    Route::post('devices/{device}/ble-mac', [BleController::class, 'saveMac']);
    Route::post('devices/{device}/ble-rpc', [BleController::class, 'rpc']);
    Route::post('devices/{device}/shelly-rpc', [ShellyRpcController::class, 'rpc']);

    // Geräteerkennung
    Route::get('discover/zigbee', [DiscoverController::class, 'zigbee']);
    Route::get('discover/all', [DiscoverController::class, 'all']);

    // Push Notifications
    Route::post('push/subscribe',   [PushController::class, 'subscribe']);
    Route::post('push/unsubscribe', [PushController::class, 'unsubscribe']);
    Route::post('push/test',        [PushController::class, 'test']);

    // Zigbee2MQTT Management
    Route::get('zigbee/devices', [ZigbeeController::class, 'devices']);
    Route::post('zigbee/permit-join', [ZigbeeController::class, 'permitJoin']);
    Route::patch('zigbee/devices/{ieee}', [ZigbeeController::class, 'rename']);
    Route::delete('zigbee/devices/{ieee}', [ZigbeeController::class, 'remove']);
    Route::post('zigbee/devices/{ieee}/import', [ZigbeeController::class, 'import']);

    // System Status
    Route::get('system/status', [SystemController::class, 'status']);

    // Panel-Einstellungen (PIN / Kiosk / Kalender) — überleben Reboot & Origin-Wechsel
    Route::get('panel-settings', [PanelSettingsController::class, 'show']);
    Route::put('panel-settings', [PanelSettingsController::class, 'update']);

    // Kalender (FamilyWall / iCal)
    Route::get('calendar/events', [CalendarController::class, 'events']);
});

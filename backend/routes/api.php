<?php

use App\Http\Controllers\Api\AutomationController;
use App\Http\Controllers\Api\BleController;
use App\Http\Controllers\Api\DeviceController;
use App\Http\Controllers\Api\DeviceLogController;
use App\Http\Controllers\Api\MqttController;
use App\Http\Controllers\Api\RoomController;
use App\Http\Controllers\Api\SceneController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function () {
    Route::apiResource('rooms', RoomController::class);
    Route::apiResource('devices', DeviceController::class);
    Route::apiResource('automations', AutomationController::class);
    Route::apiResource('scenes', SceneController::class);
    Route::post('scenes/{scene}/activate', [SceneController::class, 'activate']);

    Route::post('mqtt/publish', [MqttController::class, 'publish']);
    Route::post('devices/{device}/toggle', [MqttController::class, 'toggleDevice']);
    Route::post('devices/{device}/set-status', [DeviceController::class, 'setStatus']);
    Route::get('devices/{device}/logs', [DeviceLogController::class, 'index']);
    Route::get('devices/{device}/sensor-history', [DeviceLogController::class, 'sensorHistory']);

    // BLE
    Route::get('ble/scan', [BleController::class, 'scan']);
    Route::post('devices/{device}/ble-mac', [BleController::class, 'saveMac']);
    Route::post('devices/{device}/ble-rpc', [BleController::class, 'rpc']);
});

<?php

use App\Http\Controllers\Api\AutomationController;
use App\Http\Controllers\Api\DeviceController;
use App\Http\Controllers\Api\MqttController;
use App\Http\Controllers\Api\RoomController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function () {
    Route::apiResource('rooms', RoomController::class);
    Route::apiResource('devices', DeviceController::class);
    Route::apiResource('automations', AutomationController::class);

    Route::post('mqtt/publish', [MqttController::class, 'publish']);
    Route::post('devices/{device}/toggle', [MqttController::class, 'toggleDevice']);
});

<?php

namespace App\Http\Controllers\Api;

use App\Models\PushSubscription;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PushController
{
    public function subscribe(Request $request): JsonResponse
    {
        $data = $request->validate([
            'endpoint'    => 'required|string|max:500',
            'public_key'  => 'required|string|max:200',
            'auth_token'  => 'required|string|max:100',
            'device_name' => 'nullable|string|max:100',
        ]);

        PushSubscription::updateOrCreate(
            ['endpoint' => $data['endpoint']],
            [
                'public_key'  => $data['public_key'],
                'auth_token'  => $data['auth_token'],
                'device_name' => $data['device_name'] ?? null,
            ]
        );

        return response()->json(['ok' => true]);
    }

    public function unsubscribe(Request $request): JsonResponse
    {
        $data = $request->validate(['endpoint' => 'required|string']);
        PushSubscription::where('endpoint', $data['endpoint'])->delete();
        return response()->json(['ok' => true]);
    }

    public function test(Request $request): JsonResponse
    {
        app(\App\Services\PushNotificationService::class)->send(
            'SmartHome Test 🏠',
            'Push-Benachrichtigungen funktionieren!',
        );
        return response()->json(['ok' => true]);
    }
}

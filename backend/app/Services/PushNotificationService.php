<?php

namespace App\Services;

use App\Models\PushSubscription;
use Illuminate\Support\Facades\Log;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\WebPush;

class PushNotificationService
{
    private WebPush $webPush;

    public function __construct()
    {
        $auth = [
            'VAPID' => [
                'subject'    => config('app.url', 'http://localhost'),
                'publicKey'  => config('push.vapid_public_key'),
                'privateKey' => config('push.vapid_private_key'),
            ],
        ];
        $this->webPush = new WebPush($auth);
    }

    public function send(string $title, string $body, string $icon = '/icons/icon-192.png', ?string $url = '/'): void
    {
        $subscriptions = PushSubscription::all();
        if ($subscriptions->isEmpty()) return;

        $payload = json_encode([
            'title' => $title,
            'body'  => $body,
            'icon'  => $icon,
            'url'   => $url,
        ]);

        foreach ($subscriptions as $sub) {
            $subscription = Subscription::create([
                'endpoint'        => $sub->endpoint,
                'publicKey'       => $sub->public_key,
                'authToken'       => $sub->auth_token,
                'contentEncoding' => 'aesgcm',
            ]);
            $this->webPush->queueNotification($subscription, $payload);
        }

        foreach ($this->webPush->flush() as $report) {
            if (!$report->isSuccess()) {
                // Abgelaufene Subscriptions entfernen
                if ($report->isSubscriptionExpired()) {
                    PushSubscription::where('endpoint', $report->getRequest()->getUri()->__toString())->delete();
                }
                Log::warning('[Push] Zustellung fehlgeschlagen: ' . $report->getReason());
            }
        }
    }
}

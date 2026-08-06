<?php

namespace App\Services;

use PhpMqtt\Client\ConnectionSettings;

class MqttHelper
{
    public static function settings(int $connectTimeout = 5): ConnectionSettings
    {
        $settings = (new ConnectionSettings())->setConnectTimeout($connectTimeout);

        $username = config('mqtt.username');
        $password = config('mqtt.password');
        if ($username) {
            $settings = $settings->setUsername($username)->setPassword((string) $password);
        }

        return $settings;
    }
}

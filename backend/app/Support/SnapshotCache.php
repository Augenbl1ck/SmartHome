<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;

class SnapshotCache
{
    public const TTL_SECONDS = 86400;

    public static function get(string $key): mixed
    {
        return Cache::get($key);
    }

    public static function put(string $key, mixed $value): void
    {
        Cache::put($key, $value, now()->addSeconds(self::TTL_SECONDS));
    }
}

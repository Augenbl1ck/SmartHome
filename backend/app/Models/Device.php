<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Device extends Model
{
    protected $fillable = [
        'name', 'type', 'room_id', 'mqtt_topic',
        'status', 'attributes', 'last_seen', 'active',
    ];

    protected $casts = [
        'attributes' => 'array',
        'last_seen'  => 'datetime',
        'active'     => 'boolean',
    ];

    public function room(): BelongsTo
    {
        return $this->belongsTo(Room::class);
    }

    public function logs(): HasMany
    {
        return $this->hasMany(DeviceLog::class);
    }

    public function isWakeOnLan(): bool
    {
        return $this->type === 'computer'
            || (($this->attributes['protocol'] ?? null) === 'wake_on_lan');
    }

    public function wolMac(): ?string
    {
        $mac = $this->attributes['mac'] ?? null;

        return is_string($mac) && $mac !== '' ? $mac : null;
    }

    public function wolIp(): ?string
    {
        $ip = $this->attributes['ip'] ?? null;
        if (is_string($ip) && filter_var($ip, FILTER_VALIDATE_IP)) {
            return $ip;
        }
        $topic = $this->mqtt_topic;
        if (is_string($topic) && filter_var($topic, FILTER_VALIDATE_IP)) {
            return $topic;
        }

        return null;
    }
}

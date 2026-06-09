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
}

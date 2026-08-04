<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DeviceLog extends Model
{
    public $timestamps = false;

    protected $fillable = ['device_id', 'status', 'value', 'attributes', 'recorded_at'];

    protected $casts = [
        'attributes'  => 'array',
        'recorded_at' => 'datetime',
    ];

    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }
}

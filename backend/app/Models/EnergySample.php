<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class EnergySample extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'device_id',
        'power_w',
        'energy_wh',
        'recorded_at',
    ];

    protected $casts = [
        'power_w' => 'float',
        'energy_wh' => 'float',
        'recorded_at' => 'datetime',
    ];

    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }
}

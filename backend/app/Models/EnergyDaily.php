<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class EnergyDaily extends Model
{
    protected $table = 'energy_daily';

    public $timestamps = false;

    protected $fillable = [
        'device_id',
        'day',
        'kwh',
    ];

    protected $casts = [
        'kwh' => 'float',
    ];

    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }
}

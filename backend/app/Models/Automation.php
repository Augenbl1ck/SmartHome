<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Automation extends Model
{
    protected $fillable = [
        'name', 'trigger', 'action', 'conditions', 'enabled',
        'retry_if_blocked', 'blocked_retry_at', 'blocked_retry_started_at',
    ];

    protected $casts = [
        'trigger'                  => 'array',
        'action'                   => 'array',
        'conditions'               => 'array',
        'enabled'                  => 'boolean',
        'retry_if_blocked'         => 'boolean',
        'blocked_retry_at'         => 'datetime',
        'blocked_retry_started_at' => 'datetime',
    ];
}

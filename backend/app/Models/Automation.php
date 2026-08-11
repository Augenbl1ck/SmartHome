<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Automation extends Model
{
    protected $fillable = ['name', 'trigger', 'action', 'conditions', 'enabled'];

    protected $casts = [
        'trigger'    => 'array',
        'action'     => 'array',
        'conditions' => 'array',
        'enabled'    => 'boolean',
    ];
}

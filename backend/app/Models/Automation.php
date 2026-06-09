<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Automation extends Model
{
    protected $fillable = ['name', 'trigger', 'action', 'enabled'];

    protected $casts = [
        'trigger' => 'array',
        'action'  => 'array',
        'enabled' => 'boolean',
    ];
}

<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AutomationLog extends Model
{
    public $timestamps = false;

    protected $fillable = ['automation_id', 'automation_name', 'action_summary', 'fired_at'];

    protected $casts = [
        'fired_at' => 'datetime',
    ];
}

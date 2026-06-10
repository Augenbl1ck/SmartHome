<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Scene extends Model
{
    protected $fillable = ['name', 'icon', 'actions', 'active'];

    protected $casts = [
        'actions' => 'array',
        'active'  => 'boolean',
    ];
}

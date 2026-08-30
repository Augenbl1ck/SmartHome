<?php

namespace App\Exceptions;

use App\Models\Device;
use RuntimeException;

class DeviceCommandBlockedException extends RuntimeException
{
    public function __construct(
        public readonly Device $device,
        public readonly string $command,
        string $reason,
    ) {
        parent::__construct($reason !== '' ? "Gesperrt: {$reason}" : 'Gesperrt');
    }
}

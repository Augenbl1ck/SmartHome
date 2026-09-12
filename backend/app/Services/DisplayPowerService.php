<?php

namespace App\Services;

/**
 * Schaltet HDMI / Hintergrundlicht am Kiosk-Pi.
 * PHP kann vcgencmd/Backlight versuchen; der Kiosk-User wendet
 * denselben Befehl zusätzlich über /tmp/smarthome-display-cmd an
 * (Wayland/wlr-randr braucht die grafische Session).
 */
class DisplayPowerService
{
    public const CMD_FILE = '/tmp/smarthome-display-cmd';

    public function setOn(bool $on): void
    {
        $value = $on ? 'on' : 'off';
        @file_put_contents(self::CMD_FILE, $value . "\n");
        @chmod(self::CMD_FILE, 0666);

        $script = dirname(base_path()) . '/deploy/display-power.sh';
        if (is_executable($script) || is_file($script)) {
            @exec('bash ' . escapeshellarg($script) . ' ' . escapeshellarg($value) . ' >/dev/null 2>&1');
        }
    }
}

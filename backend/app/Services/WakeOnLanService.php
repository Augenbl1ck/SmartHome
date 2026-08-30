<?php

namespace App\Services;

use App\Models\Device;
use Illuminate\Support\Facades\Log;

/**
 * Magic Packet (Wake-on-LAN) und ICMP-Ping für Computer-Geräte.
 */
class WakeOnLanService
{
    public function sendMagicPacket(string $mac, ?string $broadcast = null): bool
    {
        $normalized = $this->normalizeMac($mac);
        if ($normalized === null) {
            Log::warning("[WakeOnLan] Ungültige MAC-Adresse: {$mac}");
            return false;
        }

        $macBytes = hex2bin(str_replace(':', '', $normalized));
        if ($macBytes === false || strlen($macBytes) !== 6) {
            return false;
        }

        $packet = str_repeat("\xFF", 6) . str_repeat($macBytes, 16);
        $broadcast = $broadcast ?: '255.255.255.255';
        $sent = false;

        foreach ([9, 7] as $port) {
            if ($this->sendUdp($packet, $broadcast, $port)) {
                $sent = true;
            }
        }

        if (! $sent) {
            $cmd = 'wakeonlan ' . escapeshellarg($normalized) . ' 2>/dev/null';
            exec($cmd, $output, $code);
            $sent = $code === 0;
            if ($sent) {
                Log::info("[WakeOnLan] Fallback wakeonlan für {$normalized}");
            }
        }

        if ($sent) {
            Log::info("[WakeOnLan] Magic Packet an {$normalized} ({$broadcast})");
        } else {
            Log::warning("[WakeOnLan] Magic Packet fehlgeschlagen für {$normalized}");
        }

        return $sent;
    }

    public function wakeDevice(Device $device): bool
    {
        $mac = $device->wolMac();
        if ($mac === null) {
            Log::warning("[WakeOnLan] Keine MAC für {$device->name}");
            return false;
        }

        $broadcast = $device->attributes['broadcast'] ?? null;
        $broadcast = is_string($broadcast) && $broadcast !== '' ? $broadcast : null;

        return $this->sendMagicPacket($mac, $broadcast);
    }

    public function ping(string $ip, int $timeoutSec = 1): bool
    {
        $ip = trim($ip);
        if (filter_var($ip, FILTER_VALIDATE_IP) === false) {
            return false;
        }

        $safeIp = escapeshellarg($ip);
        $null = PHP_OS_FAMILY === 'Windows' ? 'NUL' : '/dev/null';
        if (PHP_OS_FAMILY === 'Windows') {
            $cmd = "ping -n 1 -w " . ($timeoutSec * 1000) . " {$safeIp} 2>{$null}";
        } else {
            $cmd = "ping -c 1 -W {$timeoutSec} {$safeIp} 2>{$null}";
        }

        exec($cmd, $output, $code);

        return $code === 0;
    }

    public function normalizeMac(string $mac): ?string
    {
        $hex = strtoupper(preg_replace('/[^0-9A-Fa-f]/', '', $mac) ?? '');
        if (strlen($hex) !== 12) {
            return null;
        }

        return implode(':', str_split($hex, 2));
    }

    private function sendUdp(string $packet, string $host, int $port): bool
    {
        if (function_exists('socket_create')) {
            $sock = @socket_create(AF_INET, SOCK_DGRAM, SOL_UDP);
            if ($sock !== false) {
                @socket_set_option($sock, SOL_SOCKET, SO_BROADCAST, 1);
                $ok = @socket_sendto($sock, $packet, strlen($packet), 0, $host, $port);
                socket_close($sock);
                if ($ok !== false && $ok > 0) {
                    return true;
                }
            }
        }

        $errno = 0;
        $errstr = '';
        $fp = @stream_socket_client(
            "udp://{$host}:{$port}",
            $errno,
            $errstr,
            2
        );
        if ($fp === false) {
            return false;
        }

        stream_set_timeout($fp, 1);
        $written = @fwrite($fp, $packet);
        fclose($fp);

        return $written !== false && $written > 0;
    }
}

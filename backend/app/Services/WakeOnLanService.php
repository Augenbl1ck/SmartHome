<?php

namespace App\Services;

use App\Events\DeviceStatusUpdated;
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

    /**
     * Ist der Host im LAN erreichbar?
     *
     * Windows blockiert ICMP oft per Firewall — nach dem Ping daher ARP/Neighbor
     * prüfen (Antwort auf ARP reicht) und als Fallback TCP (auch „Connection refused“ = an).
     */
    public function isReachable(string $ip): bool
    {
        $ip = trim($ip);
        if (filter_var($ip, FILTER_VALIDATE_IP) === false) {
            return false;
        }

        $icmpOk = $this->pingIcmp($ip);
        if ($icmpOk) {
            return true;
        }

        if ($this->arpReachable($ip)) {
            return true;
        }

        return $this->tcpReachable($ip);
    }

    public function ping(string $ip, int $timeoutSec = 1): bool
    {
        return $this->isReachable($ip);
    }

    /**
     * Status eines Computer-Geräts per Ping/ARP aktualisieren.
     */
    public function refreshDevice(Device $device): bool
    {
        $ip = $device->wolIp();
        if ($ip === null) {
            return false;
        }

        $online = $this->isReachable($ip);
        $newStatus = $online ? 'on' : 'off';
        $previous = (string) $device->status;

        $attrs = $device->attributes ?? [];
        $attrs['last_ping_at'] = now()->toIso8601String();

        $updates = [
            'attributes' => $attrs,
        ];
        if ($online) {
            $updates['last_seen'] = now();
        }
        if ($newStatus !== $previous) {
            $updates['status'] = $newStatus;
        }
        $device->update($updates);

        if ($newStatus !== $previous) {
            $fresh = $device->fresh();
            if ($fresh) {
                DeviceStatusUpdated::dispatch($fresh);
                app(AutomationEngine::class)->onDeviceUpdated($fresh, $previous);
            }
        }

        return $newStatus !== $previous;
    }

    private function pingIcmp(string $ip): bool
    {
        $null = PHP_OS_FAMILY === 'Windows' ? 'NUL' : '/dev/null';
        // IP ist bereits validiert — nicht quoten, Windows-ping mag keine Single-Quotes.
        if (PHP_OS_FAMILY === 'Windows') {
            $cmd = "ping -n 1 -w 800 {$ip} 2>{$null}";
        } else {
            $cmd = "ping -c 1 -W 1 {$ip} 2>{$null}";
        }

        exec($cmd, $output, $code);

        return $code === 0;
    }

    private function arpReachable(string $ip): bool
    {
        if (PHP_OS_FAMILY === 'Windows') {
            exec('arp -a ' . $ip, $lines);
            foreach ($lines as $line) {
                if (! str_contains($line, $ip)) {
                    continue;
                }
                if (preg_match('/([0-9a-fA-F]{2}(?:[-:][0-9a-fA-F]{2}){5})/', $line)) {
                    return true;
                }
            }

            return false;
        }

        exec('ip -4 neigh show ' . escapeshellarg($ip) . ' 2>/dev/null', $lines);
        $line = $lines[0] ?? '';
        if ($line === '') {
            return false;
        }
        if (preg_match('/\b(FAILED|INCOMPLETE)\b/', $line)) {
            return false;
        }

        return (bool) preg_match('/lladdr\s+[0-9a-fA-F:]+/', $line);
    }

    private function tcpReachable(string $ip): bool
    {
        foreach ([445, 135, 3389, 22, 80, 443] as $port) {
            $errno = 0;
            $errstr = '';
            $fp = @fsockopen($ip, $port, $errno, $errstr, 0.4);
            if (is_resource($fp)) {
                fclose($fp);

                return true;
            }
            // Host hat RST geschickt → läuft, Port nur zu
            if (in_array($errno, [111, 10061, 61], true)) {
                return true;
            }
        }

        return false;
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

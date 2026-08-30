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
    public function sendMagicPacket(string $mac, ?string $broadcast = null, ?string $ip = null): bool
    {
        $normalized = $this->normalizeMac($mac);
        if ($normalized === null) {
            Log::warning("[WakeOnLan] Ungültige MAC-Adresse: {$mac}");
            return false;
        }

        $targets = $this->broadcastTargets($broadcast, $ip);

        // Das Perl-Tool `wakeonlan` auf dem Pi ist der nachweislich funktionierende Weg.
        // PHP-UDP kann „Erfolg“ melden, ohne dass das Paket im LAN als Broadcast ankommt
        // (kein SO_BROADCAST am Stream, falsches Interface) — daher CLI zuerst.
        $cliOk = $this->sendViaWakeonlanCli($normalized, $targets);
        $phpOk = $this->sendViaPhpUdp($normalized, $targets);

        if ($cliOk || $phpOk) {
            Log::info("[WakeOnLan] Magic Packet an {$normalized} (" . implode(', ', $targets) . ') cli=' . ($cliOk ? '1' : '0') . ' php=' . ($phpOk ? '1' : '0'));
            return true;
        }

        Log::warning("[WakeOnLan] Magic Packet fehlgeschlagen für {$normalized}");

        return false;
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

        return $this->sendMagicPacket($mac, $broadcast, $device->wolIp());
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

    /**
     * @return list<string>
     */
    private function broadcastTargets(?string $broadcast, ?string $ip): array
    {
        $targets = [];
        if (is_string($broadcast) && filter_var($broadcast, FILTER_VALIDATE_IP)) {
            $targets[] = $broadcast;
        }
        $directed = $this->directedBroadcast($ip);
        if ($directed !== null) {
            $targets[] = $directed;
        }
        $targets[] = '255.255.255.255';

        return array_values(array_unique($targets));
    }

    private function directedBroadcast(?string $ip): ?string
    {
        if ($ip === null || filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) === false) {
            return null;
        }
        $parts = explode('.', $ip);
        if (count($parts) !== 4) {
            return null;
        }
        $parts[3] = '255';

        return implode('.', $parts);
    }

    /**
     * @param  list<string>  $targets
     */
    private function sendViaWakeonlanCli(string $mac, array $targets): bool
    {
        $bin = $this->wakeonlanBinary();
        if ($bin === null) {
            Log::info('[WakeOnLan] wakeonlan nicht gefunden — nur PHP-UDP');

            return false;
        }

        $ok = false;
        foreach ($targets as $target) {
            $cmd = escapeshellcmd($bin) . ' -i ' . escapeshellarg($target) . ' ' . escapeshellarg($mac) . ' 2>&1';
            $output = [];
            $code = 1;
            exec($cmd, $output, $code);
            $out = trim(implode("\n", $output));
            if ($code === 0) {
                $ok = true;
                Log::info("[WakeOnLan] CLI {$bin} -i {$target} {$mac}" . ($out !== '' ? ": {$out}" : ''));
            } else {
                Log::warning("[WakeOnLan] CLI fehlgeschlagen ({$target}, code {$code}): {$out}");
            }
        }

        return $ok;
    }

    private function wakeonlanBinary(): ?string
    {
        foreach (['/usr/bin/wakeonlan', '/usr/local/bin/wakeonlan', '/bin/wakeonlan'] as $path) {
            if (is_file($path)) {
                return $path;
            }
        }

        $lines = [];
        exec('command -v wakeonlan 2>/dev/null', $lines, $code);
        $found = trim($lines[0] ?? '');
        if ($code === 0 && $found !== '') {
            return $found;
        }

        return null;
    }

    /**
     * @param  list<string>  $targets
     */
    private function sendViaPhpUdp(string $mac, array $targets): bool
    {
        $macBytes = hex2bin(str_replace(':', '', $mac));
        if ($macBytes === false || strlen($macBytes) !== 6) {
            return false;
        }

        $packet = str_repeat("\xFF", 6) . str_repeat($macBytes, 16);
        $sent = false;
        foreach ($targets as $host) {
            foreach ([9, 7] as $port) {
                for ($i = 0; $i < 2; $i++) {
                    if ($this->sendUdp($packet, $host, $port)) {
                        $sent = true;
                    }
                }
            }
        }

        return $sent;
    }

    private function sendUdp(string $packet, string $host, int $port): bool
    {
        if (! function_exists('socket_create')) {
            return $this->sendUdpStream($packet, $host, $port);
        }

        $sock = @socket_create(AF_INET, SOCK_DGRAM, SOL_UDP);
        if ($sock === false) {
            return $this->sendUdpStream($packet, $host, $port);
        }

        @socket_set_option($sock, SOL_SOCKET, SO_BROADCAST, 1);
        @socket_set_option($sock, SOL_SOCKET, SO_REUSEADDR, 1);
        $ok = @socket_sendto($sock, $packet, strlen($packet), 0, $host, $port);
        socket_close($sock);

        return $ok !== false && $ok > 0;
    }

    private function sendUdpStream(string $packet, string $host, int $port): bool
    {
        $ctx = stream_context_create([
            'socket' => ['so_broadcast' => true],
        ]);
        $errno = 0;
        $errstr = '';
        $fp = @stream_socket_client(
            "udp://{$host}:{$port}",
            $errno,
            $errstr,
            2,
            STREAM_CLIENT_CONNECT,
            $ctx
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

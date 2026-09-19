<?php

namespace App\Services;

use App\Models\Device;
use Illuminate\Support\Facades\Log;

/**
 * HTTP-Host für Shelly Gen3.
 *
 * PHP/cURL löst *.local (mDNS) auf dem Pi oft nicht auf, obwohl das Gerät
 * im LAN ist. Deshalb: gespeicherte IP → ARP (MAC aus Geräte-ID) → Avahi → IP merken.
 */
class ShellyLanHost
{
    public function resolve(Device $device, bool $refresh = false): string
    {
        $attrs = $device->extra();
        $stored = $this->cleanHost((string) ($attrs['shelly_ip'] ?? ''));
        if (! $refresh && $this->isIpv4($stored)) {
            return $stored;
        }

        $topicHost = $this->topicHost($device);
        if ($this->isIpv4($topicHost)) {
            $this->rememberIp($device, $topicHost);

            return $topicHost;
        }

        $hostname = $this->mdnsName($stored, $topicHost);
        $ip = $this->lookupIpv4($hostname, $topicHost !== '' ? $topicHost : $hostname);
        if ($ip !== null) {
            $this->rememberIp($device, $ip);

            return $ip;
        }

        return $hostname !== '' ? $hostname : ($topicHost !== '' ? $topicHost : '127.0.0.1');
    }

    private function topicHost(Device $device): string
    {
        $topic = $this->cleanHost((string) ($device->mqtt_topic ?? ''));

        return explode('/', $topic)[0];
    }

    private function mdnsName(string $stored, string $topicHost): string
    {
        $host = $stored !== '' && ! $this->isIpv4($stored) ? $stored : $topicHost;
        if ($host === '') {
            return '';
        }
        if (str_ends_with(strtolower($host), '.local')) {
            return $host;
        }

        return $host . '.local';
    }

    private function lookupIpv4(string $hostname, string $idHint): ?string
    {
        if ($hostname !== '') {
            $ip = $this->phpLookup($hostname);
            if ($ip !== null) {
                return $ip;
            }
            $ip = $this->avahiLookup($hostname);
            if ($ip !== null) {
                return $ip;
            }
            $ip = $this->getentLookup($hostname);
            if ($ip !== null) {
                return $ip;
            }
        }

        $mac = $this->macFromShellyId($idHint);
        if ($mac !== null) {
            $ip = $this->arpLookup($mac);
            if ($ip !== null) {
                return $ip;
            }
        }

        return null;
    }

    private function phpLookup(string $hostname): ?string
    {
        $resolved = @gethostbyname($hostname);

        return $this->isIpv4($resolved) && $resolved !== $hostname ? $resolved : null;
    }

    private function avahiLookup(string $hostname): ?string
    {
        if (PHP_OS_FAMILY === 'Windows') {
            return null;
        }
        exec('timeout 2 avahi-resolve -4 -n ' . escapeshellarg($hostname) . ' 2>/dev/null', $out);
        $line = $out[0] ?? '';
        if (preg_match('/(\d+\.\d+\.\d+\.\d+)/', $line, $m) && $this->isIpv4($m[1])) {
            return $m[1];
        }

        return null;
    }

    private function getentLookup(string $hostname): ?string
    {
        if (PHP_OS_FAMILY === 'Windows') {
            return null;
        }
        exec('timeout 1 getent hosts ' . escapeshellarg($hostname) . ' 2>/dev/null', $out);
        $line = $out[0] ?? '';
        if (preg_match('/^(\d+\.\d+\.\d+\.\d+)\b/', $line, $m) && $this->isIpv4($m[1])) {
            return $m[1];
        }

        return null;
    }

    private function arpLookup(string $mac): ?string
    {
        $want = strtolower(str_replace('-', ':', $mac));
        $lines = [];
        if (PHP_OS_FAMILY === 'Windows') {
            exec('arp -a', $lines);
        } else {
            exec('ip -4 neigh show 2>/dev/null', $lines);
            if ($lines === []) {
                exec('arp -an 2>/dev/null', $lines);
            }
        }
        foreach ($lines as $line) {
            if (preg_match('/(\d+\.\d+\.\d+\.\d+)/', $line, $ipM)
                && preg_match('/((?:[0-9a-fA-F]{2}[:\-]){5}[0-9a-fA-F]{2})/', $line, $macM)
            ) {
                $found = strtolower(str_replace('-', ':', $macM[1]));
                if ($found === $want && $this->isIpv4($ipM[1]) && ! str_starts_with($ipM[1], '169.254.')) {
                    return $ipM[1];
                }
            }
        }

        return null;
    }

    /** shellyplugsg3-90706947dd8c → 90:70:69:47:dd:8c */
    private function macFromShellyId(string $id): ?string
    {
        $id = strtolower(preg_replace('#\.local$#', '', $id) ?? $id);
        if (preg_match('/-([0-9a-f]{12})$/', $id, $m)) {
            return implode(':', str_split($m[1], 2));
        }

        return null;
    }

    private function rememberIp(Device $device, string $ip): void
    {
        $attrs = $device->extra();
        if (($attrs['shelly_ip'] ?? null) === $ip) {
            return;
        }
        $attrs['shelly_ip'] = $ip;
        $device->update(['attributes' => $attrs]);
        Log::info('[Shelly] ' . $device->name . ' LAN-IP: ' . $ip);
    }

    private function cleanHost(string $host): string
    {
        $host = trim($host);
        $host = preg_replace('#^https?://#i', '', $host) ?? $host;

        return rtrim($host, '/');
    }

    private function isIpv4(string $host): bool
    {
        return filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false;
    }
}

<?php

namespace App\Services;

/**
 * Findet Hosts im lokalen Netz (Ping-Sweep + ARP) für Wake-on-LAN-Einrichtung.
 *
 * @phpstan-type LanHost array{hostname: string|null, ip: string, mac: string}
 */
class LanDiscoveryService
{
    public function __construct(private readonly WakeOnLanService $wol) {}

    /**
     * @return list<LanHost>
     */
    public function scan(): array
    {
        set_time_limit(60);

        $subnet = $this->detectSubnet();
        if ($subnet !== null && $subnet['prefix'] === 24) {
            $this->pingSweep($subnet['network']);
        }

        return $this->readArpTable($subnet['selfIp'] ?? null);
    }

    /**
     * @return array{network: string, prefix: int, selfIp: string}|null
     */
    private function detectSubnet(): ?array
    {
        if (PHP_OS_FAMILY === 'Windows') {
            return $this->detectSubnetWindows();
        }

        return $this->detectSubnetLinux();
    }

    /**
     * @return array{network: string, prefix: int, selfIp: string}|null
     */
    private function detectSubnetLinux(): ?array
    {
        $iface = null;
        exec('ip -4 route show default 2>/dev/null', $routeOut);
        foreach ($routeOut as $line) {
            if (preg_match('/\bdev\s+(\S+)/', $line, $m)) {
                $iface = $m[1];
                break;
            }
        }

        $cmd = $iface
            ? 'ip -4 -o addr show dev ' . escapeshellarg($iface) . ' scope global 2>/dev/null'
            : 'ip -4 -o addr show scope global 2>/dev/null';
        exec($cmd, $addrOut);

        foreach ($addrOut as $line) {
            if (preg_match('/inet\s+(\d+\.\d+\.\d+\.\d+)\/(\d+)/', $line, $m)) {
                $ip = $m[1];
                $prefix = (int) $m[2];
                if (str_starts_with($ip, '127.') || str_starts_with($ip, '169.254.')) {
                    continue;
                }

                return [
                    'network' => $this->networkAddress($ip, $prefix),
                    'prefix'  => $prefix,
                    'selfIp'  => $ip,
                ];
            }
        }

        return null;
    }

    /**
     * @return array{network: string, prefix: int, selfIp: string}|null
     */
    private function detectSubnetWindows(): ?array
    {
        exec('ipconfig', $out);
        $ip = null;
        $mask = null;
        foreach ($out as $line) {
            if (preg_match('/IPv4[^\d]*(\d+\.\d+\.\d+\.\d+)/i', $line, $m)) {
                $candidate = $m[1];
                if (! str_starts_with($candidate, '127.') && ! str_starts_with($candidate, '169.254.')) {
                    $ip = $candidate;
                }
            }
            if ($ip && preg_match('/(Subnet Mask|Subnetzmaske)[^\d]*(\d+\.\d+\.\d+\.\d+)/i', $line, $m)) {
                $mask = $m[2];
                break;
            }
        }

        if (! $ip) {
            return null;
        }

        $prefix = $mask ? $this->maskToPrefix($mask) : 24;

        return [
            'network' => $this->networkAddress($ip, $prefix),
            'prefix'  => $prefix,
            'selfIp'  => $ip,
        ];
    }

    private function pingSweep(string $network): void
    {
        $parts = explode('.', $network);
        if (count($parts) !== 4) {
            return;
        }
        $prefix = $parts[0] . '.' . $parts[1] . '.' . $parts[2] . '.';
        if (! preg_match('/^\d{1,3}\.\d{1,3}\.\d{1,3}\.$/', $prefix)) {
            return;
        }

        if (PHP_OS_FAMILY === 'Windows') {
            // Auf Windows nur vorhandene ARP-Einträge nutzen — Sweep wäre zu langsam.
            return;
        }

        $cmd = "seq 1 254 | xargs -P 50 -I{} ping -c 1 -W 1 {$prefix}{} >/dev/null 2>&1";
        exec($cmd);
    }

    /**
     * @return list<LanHost>
     */
    private function readArpTable(?string $selfIp): array
    {
        $hosts = [];
        $seenMac = [];

        if (PHP_OS_FAMILY === 'Windows') {
            exec('arp -a', $lines);
            foreach ($lines as $line) {
                if (! preg_match('/(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F]{2}(?:[-:][0-9a-fA-F]{2}){5})/', $line, $m)) {
                    continue;
                }
                $this->addHost($hosts, $seenMac, $m[1], $m[2], $selfIp);
            }
        } else {
            exec('ip -4 neigh show 2>/dev/null', $lines);
            if ($lines === []) {
                exec('arp -an 2>/dev/null', $lines);
            }
            foreach ($lines as $line) {
                if (! preg_match('/(\d+\.\d+\.\d+\.\d+).+?((?:[0-9a-fA-F]{2}[:\-]){5}[0-9a-fA-F]{2})/', $line, $m)) {
                    continue;
                }
                if (preg_match('/\b(FAILED|INCOMPLETE)\b/', $line)) {
                    continue;
                }
                $this->addHost($hosts, $seenMac, $m[1], $m[2], $selfIp);
            }
        }

        usort($hosts, fn ($a, $b) => strnatcmp($a['ip'], $b['ip']));

        return $hosts;
    }

    /**
     * @param  list<LanHost>  $hosts
     * @param  array<string, true>  $seenMac
     */
    private function addHost(array &$hosts, array &$seenMac, string $ip, string $macRaw, ?string $selfIp): void
    {
        if ($selfIp && $ip === $selfIp) {
            return;
        }
        if (str_starts_with($ip, '127.') || str_starts_with($ip, '169.254.')) {
            return;
        }

        $mac = $this->wol->normalizeMac($macRaw);
        if ($mac === null || $mac === '00:00:00:00:00:00' || $mac === 'FF:FF:FF:FF:FF:FF') {
            return;
        }
        // Multicast
        $firstOctet = hexdec(substr($mac, 0, 2));
        if (($firstOctet & 0x01) === 1) {
            return;
        }
        if (isset($seenMac[$mac])) {
            return;
        }
        $seenMac[$mac] = true;

        $hostname = $this->lookupHostname($ip);

        $hosts[] = [
            'hostname' => $hostname,
            'ip'       => $ip,
            'mac'      => $mac,
        ];
    }

    private function lookupHostname(string $ip): ?string
    {
        if (PHP_OS_FAMILY === 'Windows') {
            return null;
        }

        exec('timeout 0.3 getent hosts ' . escapeshellarg($ip) . ' 2>/dev/null', $out);
        $line = $out[0] ?? '';
        if ($line === '') {
            return null;
        }
        $parts = preg_split('/\s+/', trim($line)) ?: [];
        $name = $parts[1] ?? null;
        if (! is_string($name) || $name === '' || $name === $ip) {
            return null;
        }

        return $name;
    }

    private function networkAddress(string $ip, int $prefix): string
    {
        $long = ip2long($ip);
        if ($long === false) {
            return $ip;
        }
        $mask = $prefix === 0 ? 0 : (-1 << (32 - $prefix));
        $network = $long & $mask;

        return long2ip($network) ?: $ip;
    }

    private function maskToPrefix(string $mask): int
    {
        $long = ip2long($mask);
        if ($long === false) {
            return 24;
        }

        return (int) substr_count(decbin($long), '1');
    }
}

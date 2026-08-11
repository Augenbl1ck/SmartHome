<?php

namespace App\Services;

use App\Models\PanelSetting;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class TransitService
{
    private const BASE = 'https://v6.db.transport.rest';

    private const LOCATIONS_TTL = 300;

    private const BOARD_TTL = 60;

    /**
     * @return list<array{id: string, name: string, type: string}>
     */
    public function searchLocations(string $query): array
    {
        $query = trim($query);
        if (mb_strlen($query) < 2) {
            return [];
        }

        $cacheKey = 'transit_loc_' . sha1(mb_strtolower($query));

        return Cache::remember($cacheKey, self::LOCATIONS_TTL, function () use ($query) {
            $res = Http::timeout(15)
                ->acceptJson()
                ->get(self::BASE . '/locations', [
                    'query' => $query,
                    'results' => 8,
                    'stops' => 'true',
                    'addresses' => 'false',
                    'poi' => 'false',
                ]);

            if (!$res->successful()) {
                throw new RuntimeException('Stationssuche fehlgeschlagen (HTTP ' . $res->status() . ')');
            }

            $items = $res->json();
            if (!is_array($items)) {
                return [];
            }

            $out = [];
            foreach ($items as $item) {
                if (!is_array($item)) {
                    continue;
                }
                $type = (string) ($item['type'] ?? '');
                if (!in_array($type, ['stop', 'station'], true)) {
                    continue;
                }
                $id = (string) ($item['id'] ?? '');
                $name = (string) ($item['name'] ?? '');
                if ($id === '' || $name === '') {
                    continue;
                }
                $out[] = ['id' => $id, 'name' => $name, 'type' => $type];
            }

            return $out;
        });
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function departures(string $stopId): array
    {
        $stopId = trim($stopId);
        if ($stopId === '') {
            return [];
        }

        $cacheKey = 'transit_dep_' . sha1($stopId);

        return Cache::remember($cacheKey, self::BOARD_TTL, function () use ($stopId) {
            $res = Http::timeout(20)
                ->acceptJson()
                ->get(self::BASE . '/stops/' . rawurlencode($stopId) . '/departures', [
                    'duration' => 60,
                    'results' => 6,
                ]);

            if (!$res->successful()) {
                throw new RuntimeException('Abfahrten nicht ladbar (HTTP ' . $res->status() . ')');
            }

            $body = $res->json();
            $list = is_array($body) ? ($body['departures'] ?? $body) : [];
            if (!is_array($list)) {
                return [];
            }

            $out = [];
            foreach (array_slice($list, 0, 6) as $row) {
                if (!is_array($row)) {
                    continue;
                }
                $mapped = $this->mapDeparture($row);
                if ($mapped !== null) {
                    $out[] = $mapped;
                }
            }

            return $out;
        });
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function journeys(string $fromId, string $toId): array
    {
        $fromId = trim($fromId);
        $toId = trim($toId);
        if ($fromId === '' || $toId === '') {
            return [];
        }

        $cacheKey = 'transit_jny_' . sha1($fromId . '|' . $toId);

        return Cache::remember($cacheKey, self::BOARD_TTL, function () use ($fromId, $toId) {
            $res = Http::timeout(25)
                ->acceptJson()
                ->get(self::BASE . '/journeys', [
                    'from' => $fromId,
                    'to' => $toId,
                    'results' => 3,
                    'stopovers' => 'false',
                ]);

            if (!$res->successful()) {
                throw new RuntimeException('Verbindungen nicht ladbar (HTTP ' . $res->status() . ')');
            }

            $body = $res->json();
            $list = is_array($body) ? ($body['journeys'] ?? []) : [];
            if (!is_array($list)) {
                return [];
            }

            $out = [];
            foreach (array_slice($list, 0, 3) as $row) {
                if (!is_array($row)) {
                    continue;
                }
                $mapped = $this->mapJourney($row);
                if ($mapped !== null) {
                    $out[] = $mapped;
                }
            }

            return $out;
        });
    }

    /**
     * Board from panel-settings.transit
     *
     * @return array{
     *   configured: bool,
     *   stations: list<array<string, mixed>>,
     *   connections: list<array<string, mixed>>,
     *   error: string|null
     * }
     */
    public function board(): array
    {
        $cfg = $this->normalizedConfig();
        $stationsCfg = $cfg['stations'];
        $connectionsCfg = $cfg['connections'];

        if ($stationsCfg === [] && $connectionsCfg === []) {
            return [
                'configured' => false,
                'stations' => [],
                'connections' => [],
                'error' => null,
            ];
        }

        $errors = [];
        $stations = [];
        foreach ($stationsCfg as $stop) {
            try {
                $stations[] = [
                    'stop' => $stop,
                    'departures' => $this->departures($stop['id']),
                ];
            } catch (\Throwable $e) {
                $stations[] = [
                    'stop' => $stop,
                    'departures' => [],
                    'error' => $e->getMessage(),
                ];
                $errors[] = $e->getMessage();
            }
        }

        $connections = [];
        foreach ($connectionsCfg as $conn) {
            try {
                $connections[] = [
                    'id' => $conn['id'],
                    'label' => $conn['label'],
                    'from' => $conn['from'],
                    'to' => $conn['to'],
                    'journeys' => $this->journeys($conn['from']['id'], $conn['to']['id']),
                ];
            } catch (\Throwable $e) {
                $connections[] = [
                    'id' => $conn['id'],
                    'label' => $conn['label'],
                    'from' => $conn['from'],
                    'to' => $conn['to'],
                    'journeys' => [],
                    'error' => $e->getMessage(),
                ];
                $errors[] = $e->getMessage();
            }
        }

        return [
            'configured' => true,
            'stations' => $stations,
            'connections' => $connections,
            'error' => $errors === [] ? null : implode('; ', array_unique($errors)),
        ];
    }

    /**
     * @return array{
     *   stations: list<array{id: string, name: string}>,
     *   connections: list<array{id: string, label: string, from: array{id: string, name: string}, to: array{id: string, name: string}}>
     * }
     */
    public function normalizedConfig(): array
    {
        $raw = PanelSetting::getValue('transit');
        if (!is_array($raw)) {
            return ['stations' => [], 'connections' => []];
        }

        $stations = [];
        foreach (array_slice($raw['stations'] ?? [], 0, 3) as $s) {
            if (!is_array($s)) {
                continue;
            }
            $id = trim((string) ($s['id'] ?? ''));
            $name = trim((string) ($s['name'] ?? ''));
            if ($id === '' || $name === '') {
                continue;
            }
            $stations[] = ['id' => $id, 'name' => $name];
        }

        $connections = [];
        foreach (array_slice($raw['connections'] ?? [], 0, 3) as $c) {
            if (!is_array($c)) {
                continue;
            }
            $from = is_array($c['from'] ?? null) ? $c['from'] : [];
            $to = is_array($c['to'] ?? null) ? $c['to'] : [];
            $fromId = trim((string) ($from['id'] ?? ''));
            $fromName = trim((string) ($from['name'] ?? ''));
            $toId = trim((string) ($to['id'] ?? ''));
            $toName = trim((string) ($to['name'] ?? ''));
            if ($fromId === '' || $toId === '' || $fromName === '' || $toName === '') {
                continue;
            }
            $id = trim((string) ($c['id'] ?? ''));
            if ($id === '') {
                $id = 'c_' . substr(sha1($fromId . '|' . $toId), 0, 8);
            }
            $label = trim((string) ($c['label'] ?? ''));
            if ($label === '') {
                $label = $fromName . ' → ' . $toName;
            }
            $connections[] = [
                'id' => $id,
                'label' => $label,
                'from' => ['id' => $fromId, 'name' => $fromName],
                'to' => ['id' => $toId, 'name' => $toName],
            ];
        }

        return ['stations' => $stations, 'connections' => $connections];
    }

    /**
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>|null
     */
    private function mapDeparture(array $row): ?array
    {
        $line = $row['line'] ?? null;
        $lineName = '';
        $product = '';
        if (is_array($line)) {
            $lineName = (string) ($line['name'] ?? $line['fahrtNr'] ?? '');
            $product = (string) ($line['product'] ?? '');
        }
        $when = $row['when'] ?? $row['plannedWhen'] ?? null;
        if (!is_string($when) || $when === '') {
            return null;
        }
        $planned = is_string($row['plannedWhen'] ?? null) ? $row['plannedWhen'] : $when;
        $delay = isset($row['delay']) && is_numeric($row['delay']) ? (int) $row['delay'] : null;
        $cancelled = (bool) ($row['cancelled'] ?? false);
        $platform = $row['platform'] ?? $row['plannedPlatform'] ?? null;
        $direction = (string) ($row['direction'] ?? '');
        if ($direction === '' && is_array($row['destination'] ?? null)) {
            $direction = (string) ($row['destination']['name'] ?? '');
        }

        return [
            'line' => $lineName !== '' ? $lineName : 'Zug',
            'product' => $product,
            'direction' => $direction,
            'when' => $when,
            'plannedWhen' => $planned,
            'delay' => $delay,
            'cancelled' => $cancelled,
            'platform' => $platform !== null ? (string) $platform : null,
        ];
    }

    /**
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>|null
     */
    private function mapJourney(array $row): ?array
    {
        $legs = is_array($row['legs'] ?? null) ? $row['legs'] : [];
        if ($legs === []) {
            return null;
        }

        $first = $legs[0];
        $last = $legs[count($legs) - 1];
        if (!is_array($first) || !is_array($last)) {
            return null;
        }

        $departure = $first['departure'] ?? $first['plannedDeparture'] ?? null;
        $arrival = $last['arrival'] ?? $last['plannedArrival'] ?? null;
        if (!is_string($departure) || !is_string($arrival)) {
            return null;
        }

        $depTs = strtotime($departure);
        $arrTs = strtotime($arrival);
        $durationMin = ($depTs && $arrTs && $arrTs >= $depTs)
            ? (int) round(($arrTs - $depTs) / 60)
            : null;

        $walkingOrChange = 0;
        $legSummaries = [];
        $delay = null;
        $cancelled = false;

        foreach ($legs as $leg) {
            if (!is_array($leg)) {
                continue;
            }
            if (!empty($leg['walking'])) {
                $walkingOrChange++;
                continue;
            }
            $line = is_array($leg['line'] ?? null) ? $leg['line'] : [];
            $lineName = (string) ($line['name'] ?? '');
            $dir = (string) ($leg['direction'] ?? '');
            if ($dir === '' && is_array($leg['destination'] ?? null)) {
                $dir = (string) ($leg['destination']['name'] ?? '');
            }
            if ($lineName !== '') {
                $legSummaries[] = [
                    'line' => $lineName,
                    'direction' => $dir,
                    'product' => (string) ($line['product'] ?? ''),
                ];
            }
            if (isset($leg['departureDelay']) && is_numeric($leg['departureDelay'])) {
                $d = (int) $leg['departureDelay'];
                $delay = $delay === null ? $d : max($delay, $d);
            }
            if (!empty($leg['cancelled'])) {
                $cancelled = true;
            }
        }

        // changes ≈ public transport legs - 1
        $ptLegs = count($legSummaries);
        $changes = max(0, $ptLegs - 1);

        return [
            'departure' => $departure,
            'arrival' => $arrival,
            'durationMin' => $durationMin,
            'changes' => $changes,
            'legs' => array_slice($legSummaries, 0, 4),
            'delay' => $delay,
            'cancelled' => $cancelled,
        ];
    }
}

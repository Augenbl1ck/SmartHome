<?php

namespace App\Services;

use App\Models\PanelSetting;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * Transit via Transitous (MOTIS) — open community API.
 * DB Vendo (app.services-bahn.de) is often blocked (Akamai TLS / HTTP 452) from server TLS stacks.
 */
class TransitService
{
    private const BASE = 'https://api.transitous.org/api';

    private const USER_AGENT = 'SmartHomePanel/1.0 (open-source home dashboard; local use)';

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

        $cacheKey = 'transit_loc_motis_' . sha1(mb_strtolower($query));

        return Cache::remember($cacheKey, self::LOCATIONS_TTL, function () use ($query) {
            $res = $this->motisGet('/v1/geocode', [
                'text' => $query,
                'type' => 'STOP',
            ]);

            if (!$res->successful()) {
                throw new RuntimeException('Stationssuche fehlgeschlagen (HTTP ' . $res->status() . ')');
            }

            $items = $res->json();
            if (!is_array($items)) {
                return [];
            }

            $out = [];
            $seen = [];
            foreach ($items as $item) {
                if (!is_array($item)) {
                    continue;
                }
                if (strtoupper((string) ($item['type'] ?? '')) !== 'STOP') {
                    continue;
                }
                $id = $this->preferParentId($item);
                $name = trim((string) ($item['name'] ?? ''));
                if ($id === '' || $name === '') {
                    continue;
                }
                if (isset($seen[$id])) {
                    continue;
                }
                $seen[$id] = true;
                $out[] = ['id' => $id, 'name' => $name, 'type' => 'station'];
                if (count($out) >= 8) {
                    break;
                }
            }

            return $out;
        });
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function departures(string $stopId, ?string $fallbackName = null): array
    {
        $stopId = trim($stopId);
        if ($stopId === '') {
            return [];
        }

        $resolved = $this->resolveStopId($stopId, $fallbackName);
        $cacheKey = 'transit_dep_motis_' . sha1($resolved);

        return Cache::remember($cacheKey, self::BOARD_TTL, function () use ($resolved) {
            $res = $this->motisGet('/v5/stoptimes', [
                'stopId' => $resolved,
                'n' => 8,
                'arriveBy' => 'false',
            ]);

            if (!$res->successful()) {
                throw new RuntimeException('Abfahrten nicht ladbar (HTTP ' . $res->status() . ')');
            }

            $body = $res->json();
            $list = is_array($body) ? ($body['stopTimes'] ?? []) : [];
            if (!is_array($list)) {
                return [];
            }

            $out = [];
            foreach ($list as $row) {
                if (!is_array($row)) {
                    continue;
                }
                $mapped = $this->mapDeparture($row);
                if ($mapped !== null) {
                    $out[] = $mapped;
                }
                if (count($out) >= 6) {
                    break;
                }
            }

            return $out;
        });
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function journeys(string $fromId, string $toId, ?string $fromName = null, ?string $toName = null): array
    {
        $fromId = trim($fromId);
        $toId = trim($toId);
        if ($fromId === '' || $toId === '') {
            return [];
        }

        $from = $this->resolveStopId($fromId, $fromName);
        $to = $this->resolveStopId($toId, $toName);
        $cacheKey = 'transit_jny_motis_' . sha1($from . '|' . $to);

        return Cache::remember($cacheKey, self::BOARD_TTL, function () use ($from, $to) {
            $res = $this->motisGet('/v5/plan', [
                'fromPlace' => $from,
                'toPlace' => $to,
                'n' => 3,
                'detailedTransfers' => 'false',
            ]);

            if (!$res->successful()) {
                throw new RuntimeException('Verbindungen nicht ladbar (HTTP ' . $res->status() . ')');
            }

            $body = $res->json();
            $list = is_array($body) ? ($body['itineraries'] ?? []) : [];
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
                    'departures' => $this->departures($stop['id'], $stop['name']),
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
                    'journeys' => $this->journeys(
                        $conn['from']['id'],
                        $conn['to']['id'],
                        $conn['from']['name'],
                        $conn['to']['name'],
                    ),
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
     * @param  array<string, string|int|bool>  $query
     */
    private function motisGet(string $path, array $query): \Illuminate\Http\Client\Response
    {
        return Http::timeout(25)
            ->withHeaders([
                'Accept' => 'application/json',
                'User-Agent' => self::USER_AGENT,
            ])
            ->get(self::BASE . $path, $query);
    }

    /**
     * Prefer station/parent IDs over platform-level IDs for stabler boards.
     *
     * @param  array<string, mixed>  $item
     */
    private function preferParentId(array $item): string
    {
        $id = trim((string) ($item['id'] ?? ''));
        // Common Motis pattern: …:area:stop:platform — collapse to area:stop when possible is unsafe.
        // Prefer explicit parent if present.
        $parent = trim((string) ($item['parentId'] ?? $item['parent'] ?? ''));
        if ($parent !== '') {
            return $parent;
        }

        return $id;
    }

    /**
     * Resolve legacy EVA IDs (numeric) via name search when needed.
     */
    private function resolveStopId(string $id, ?string $name = null): string
    {
        if (!$this->looksLikeLegacyEva($id)) {
            return $id;
        }

        $name = trim((string) $name);
        if ($name === '') {
            return $id;
        }

        $cacheKey = 'transit_resolve_motis_' . sha1(mb_strtolower($name));

        return Cache::remember($cacheKey, self::LOCATIONS_TTL, function () use ($name, $id) {
            try {
                $hits = $this->searchLocations($name);
                if ($hits !== []) {
                    return $hits[0]['id'];
                }
            } catch (\Throwable) {
                /* keep legacy id */
            }

            return $id;
        });
    }

    private function looksLikeLegacyEva(string $id): bool
    {
        return (bool) preg_match('/^\d{6,9}$/', $id);
    }

    /**
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>|null
     */
    private function mapDeparture(array $row): ?array
    {
        $place = is_array($row['place'] ?? null) ? $row['place'] : [];
        $when = $place['departure'] ?? $place['scheduledDeparture'] ?? null;
        $planned = $place['scheduledDeparture'] ?? $when;
        if (!is_string($when) || $when === '') {
            return null;
        }
        if (!is_string($planned) || $planned === '') {
            $planned = $when;
        }

        $delay = null;
        $whenTs = strtotime($when);
        $plannedTs = strtotime($planned);
        if ($whenTs && $plannedTs) {
            $delay = $whenTs - $plannedTs;
        }

        $line = trim((string) ($row['displayName'] ?? $row['routeShortName'] ?? $row['tripShortName'] ?? ''));
        if ($line === '') {
            $line = (string) ($row['mode'] ?? 'Zug');
        }

        $platform = $place['track'] ?? $place['scheduledTrack'] ?? null;
        $cancelled = (bool) ($row['cancelled'] ?? $row['tripCancelled'] ?? $place['cancelled'] ?? false);

        return [
            'line' => $line,
            'product' => (string) ($row['mode'] ?? ''),
            'direction' => (string) ($row['headsign'] ?? $row['tripTo']['name'] ?? ''),
            'when' => $when,
            'plannedWhen' => $planned,
            'delay' => $delay,
            'cancelled' => $cancelled,
            'platform' => $platform !== null && $platform !== '' ? (string) $platform : null,
        ];
    }

    /**
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>|null
     */
    private function mapJourney(array $row): ?array
    {
        $legs = is_array($row['legs'] ?? null) ? $row['legs'] : [];
        $departure = is_string($row['startTime'] ?? null) ? $row['startTime'] : null;
        $arrival = is_string($row['endTime'] ?? null) ? $row['endTime'] : null;

        $legSummaries = [];
        $delay = null;
        $cancelled = false;

        foreach ($legs as $leg) {
            if (!is_array($leg)) {
                continue;
            }
            $mode = strtoupper((string) ($leg['mode'] ?? ''));
            if (in_array($mode, ['WALK', 'BICYCLE', 'CAR', 'RENTAL'], true)) {
                continue;
            }
            $line = trim((string) ($leg['displayName'] ?? $leg['routeShortName'] ?? $leg['tripShortName'] ?? ''));
            if ($line === '') {
                $line = $mode !== '' ? $mode : 'Zug';
            }
            $legSummaries[] = [
                'line' => $line,
                'direction' => (string) ($leg['headsign'] ?? $leg['to']['name'] ?? ''),
                'product' => (string) ($leg['mode'] ?? ''),
            ];

            if (isset($leg['departureDelay']) && is_numeric($leg['departureDelay'])) {
                // Motis delay often in seconds
                $d = (int) $leg['departureDelay'];
                $delay = $delay === null ? $d : max($delay, $d);
            }
            if (!empty($leg['cancelled']) || !empty($leg['from']['cancelled'])) {
                $cancelled = true;
            }

            if ($departure === null && is_string($leg['startTime'] ?? null)) {
                $departure = $leg['startTime'];
            }
            if (is_string($leg['endTime'] ?? null)) {
                $arrival = $leg['endTime'];
            }
        }

        if ($departure === null || $arrival === null) {
            return null;
        }

        $durationMin = null;
        if (isset($row['duration']) && is_numeric($row['duration'])) {
            $durationMin = (int) round(((int) $row['duration']) / 60);
        } else {
            $depTs = strtotime($departure);
            $arrTs = strtotime($arrival);
            if ($depTs && $arrTs && $arrTs >= $depTs) {
                $durationMin = (int) round(($arrTs - $depTs) / 60);
            }
        }

        $changes = isset($row['transfers']) && is_numeric($row['transfers'])
            ? (int) $row['transfers']
            : max(0, count($legSummaries) - 1);

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

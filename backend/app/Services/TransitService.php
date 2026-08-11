<?php

namespace App\Services;

use App\Models\PanelSetting;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * DB Navigator / Vendo APIs (app.services-bahn.de).
 * The public v6.db.transport.rest proxy often returns 503 after HAFAS shutdown.
 */
class TransitService
{
    private const LOCATIONS_URL = 'https://app.services-bahn.de/mob/location/search';

    private const DEPARTURES_URL = 'https://app.services-bahn.de/mob/bahnhofstafel/abfahrt';

    private const JOURNEYS_URL = 'https://app.services-bahn.de/mob/angebote/fahrplan';

    private const LOCATIONS_TTL = 300;

    private const BOARD_TTL = 60;

    private const PRODUCTS = [
        'HOCHGESCHWINDIGKEITSZUEGE',
        'INTERCITYUNDEUROCITYZUEGE',
        'INTERREGIOUNDSCHNELLZUEGE',
        'NAHVERKEHRSONSTIGEZUEGE',
        'SBAHNEN',
        'BUSSE',
        'SCHIFFE',
        'UBAHN',
        'STRASSENBAHN',
        'ANRUFPFLICHTIGEVERKEHRE',
    ];

    /**
     * @return list<array{id: string, name: string, type: string}>
     */
    public function searchLocations(string $query): array
    {
        $query = trim($query);
        if (mb_strlen($query) < 2) {
            return [];
        }

        $cacheKey = 'transit_loc_v2_' . sha1(mb_strtolower($query));

        return Cache::remember($cacheKey, self::LOCATIONS_TTL, function () use ($query) {
            $res = $this->vendoPost(
                self::LOCATIONS_URL,
                'application/x.db.vendo.mob.location.v3+json',
                [
                    'locationTypes' => ['ST'],
                    'searchTerm' => $query,
                    'maxResults' => 8,
                ],
            );

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
                $id = trim((string) ($item['evaNr'] ?? ''));
                $name = trim((string) ($item['name'] ?? ''));
                if ($id === '' || $name === '') {
                    continue;
                }
                $out[] = ['id' => $id, 'name' => $name, 'type' => 'station'];
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

        $cacheKey = 'transit_dep_v2_' . sha1($stopId);

        return Cache::remember($cacheKey, self::BOARD_TTL, function () use ($stopId) {
            $now = now('Europe/Berlin');
            $res = $this->vendoPost(
                self::DEPARTURES_URL,
                'application/x.db.vendo.mob.bahnhofstafeln.v2+json',
                [
                    'anfragezeit' => $now->format('H:i'),
                    'datum' => $now->format('Y-m-d'),
                    'ursprungsBahnhofId' => $this->stationLid($stopId),
                    'verkehrsmittel' => self::PRODUCTS,
                ],
            );

            if (!$res->successful()) {
                throw new RuntimeException('Abfahrten nicht ladbar (HTTP ' . $res->status() . ')');
            }

            $body = $res->json();
            $list = is_array($body) ? ($body['bahnhofstafelAbfahrtPositionen'] ?? []) : [];
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

        $cacheKey = 'transit_jny_v2_' . sha1($fromId . '|' . $toId);

        return Cache::remember($cacheKey, self::BOARD_TTL, function () use ($fromId, $toId) {
            $when = now('Europe/Berlin')->format('Y-m-d\TH:i:s');
            $res = $this->vendoPost(
                self::JOURNEYS_URL,
                'application/x.db.vendo.mob.verbindungssuche.v9+json',
                [
                    'autonomeReservierung' => false,
                    'einstiegsTypList' => ['STANDARD'],
                    'fahrverguenstigungen' => [
                        'deutschlandTicketVorhanden' => false,
                        'nurDeutschlandTicketVerbindungen' => false,
                    ],
                    'klasse' => 'KLASSE_2',
                    'reisendenProfil' => [
                        'reisende' => [[
                            'ermaessigungen' => ['KEINE_ERMAESSIGUNG KLASSE_2'],
                            'reisendenTyp' => 'ERWACHSENER',
                        ]],
                    ],
                    'reservierungsKontingenteVorhanden' => false,
                    'reiseHin' => [
                        'wunsch' => [
                            'abgangsLocationId' => $this->stationLid($fromId),
                            'zielLocationId' => $this->stationLid($toId),
                            'alternativeHalteBerechnung' => true,
                            'verkehrsmittel' => self::PRODUCTS,
                            'zeitWunsch' => [
                                'reiseDatum' => $when,
                                'zeitPunktArt' => 'ABFAHRT',
                            ],
                        ],
                    ],
                ],
            );

            if (!$res->successful()) {
                throw new RuntimeException('Verbindungen nicht ladbar (HTTP ' . $res->status() . ')');
            }

            $body = $res->json();
            $list = is_array($body) ? ($body['verbindungen'] ?? []) : [];
            if (!is_array($list)) {
                return [];
            }

            $out = [];
            foreach (array_slice($list, 0, 3) as $row) {
                if (!is_array($row)) {
                    continue;
                }
                $conn = is_array($row['verbindung'] ?? null) ? $row['verbindung'] : $row;
                $mapped = $this->mapJourney($conn);
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
     * @param  array<string, mixed>  $body
     */
    private function vendoPost(string $url, string $contentType, array $body): \Illuminate\Http\Client\Response
    {
        return Http::timeout(25)
            ->withHeaders([
                'Accept' => $contentType,
                'Content-Type' => $contentType,
                'X-Correlation-ID' => (string) Str::uuid() . '_' . (string) Str::uuid(),
                'User-Agent' => 'SmartHomePanel/1.0',
            ])
            ->withBody(json_encode($body, JSON_UNESCAPED_UNICODE), $contentType)
            ->post($url);
    }

    private function stationLid(string $evaOrLid): string
    {
        if (str_contains($evaOrLid, '@') || str_starts_with($evaOrLid, 'A=')) {
            return $evaOrLid;
        }

        return 'A=1@L=' . $evaOrLid . '@';
    }

    /**
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>|null
     */
    private function mapDeparture(array $row): ?array
    {
        $planned = $row['abgangsDatum'] ?? null;
        $when = $row['ezAbgangsDatum'] ?? $planned;
        if (!is_string($when) || $when === '') {
            return null;
        }
        if (!is_string($planned) || $planned === '') {
            $planned = $when;
        }

        $delay = null;
        $plannedTs = strtotime($planned);
        $whenTs = strtotime($when);
        if ($plannedTs && $whenTs) {
            $delay = $whenTs - $plannedTs;
        }

        $line = trim((string) ($row['mitteltext'] ?? $row['kurztext'] ?? ''));
        if ($line === '') {
            $line = 'Zug';
        }

        $notes = $row['echtzeitNotizen'] ?? [];
        $cancelled = false;
        if (is_array($notes)) {
            foreach ($notes as $n) {
                $text = is_array($n) ? (string) ($n['text'] ?? '') : (string) $n;
                if (stripos($text, 'entfällt') !== false || stripos($text, 'cancelled') !== false) {
                    $cancelled = true;
                    break;
                }
            }
        }

        $platform = $row['gleis'] ?? $row['plattform'] ?? null;

        return [
            'line' => $line,
            'product' => (string) ($row['produktGattung'] ?? $row['kurztext'] ?? ''),
            'direction' => (string) ($row['richtung'] ?? ''),
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
        $sections = is_array($row['verbindungsAbschnitte'] ?? null) ? $row['verbindungsAbschnitte'] : [];
        $firstPt = null;
        $lastPt = null;
        $legSummaries = [];

        foreach ($sections as $sec) {
            if (!is_array($sec)) {
                continue;
            }
            $typ = (string) ($sec['typ'] ?? '');
            if ($typ !== '' && $typ !== 'FAHRZEUG') {
                continue;
            }
            if ($firstPt === null) {
                $firstPt = $sec;
            }
            $lastPt = $sec;
            $lineName = trim((string) ($sec['mitteltext'] ?? $sec['kurztext'] ?? ''));
            if ($lineName !== '') {
                $legSummaries[] = [
                    'line' => $lineName,
                    'direction' => (string) ($sec['richtung'] ?? ''),
                    'product' => (string) ($sec['produktGattung'] ?? $sec['kurztext'] ?? ''),
                ];
            }
        }

        $plannedDep = is_string($row['abgangsDatum'] ?? null)
            ? $row['abgangsDatum']
            : (is_array($firstPt) ? ($firstPt['abgangsDatum'] ?? null) : null);
        $actualDep = is_string($row['ezAbgangsDatum'] ?? null)
            ? $row['ezAbgangsDatum']
            : (is_array($firstPt) ? ($firstPt['ezAbgangsDatum'] ?? $plannedDep) : $plannedDep);
        $plannedArr = is_string($row['ankunftsDatum'] ?? null)
            ? $row['ankunftsDatum']
            : (is_array($lastPt) ? ($lastPt['ankunftsDatum'] ?? null) : null);
        $actualArr = is_string($row['ezAnkunftsDatum'] ?? null)
            ? $row['ezAnkunftsDatum']
            : (is_array($lastPt) ? ($lastPt['ezAnkunftsDatum'] ?? $plannedArr) : $plannedArr);

        $departure = is_string($actualDep) && $actualDep !== '' ? $actualDep : (is_string($plannedDep) ? $plannedDep : null);
        $arrival = is_string($actualArr) && $actualArr !== '' ? $actualArr : (is_string($plannedArr) ? $plannedArr : null);
        if ($departure === null || $arrival === null) {
            return null;
        }

        $durationMin = null;
        if (isset($row['reiseDauer']) && is_numeric($row['reiseDauer'])) {
            $durationMin = (int) round(((int) $row['reiseDauer']) / 60);
        } else {
            $depTs = strtotime($departure);
            $arrTs = strtotime($arrival);
            if ($depTs && $arrTs && $arrTs >= $depTs) {
                $durationMin = (int) round(($arrTs - $depTs) / 60);
            }
        }

        $changes = isset($row['umstiegeAnzahl']) && is_numeric($row['umstiegeAnzahl'])
            ? (int) $row['umstiegeAnzahl']
            : max(0, count($legSummaries) - 1);

        $delay = null;
        if (is_string($plannedDep) && is_string($actualDep)) {
            $p = strtotime($plannedDep);
            $a = strtotime($actualDep);
            if ($p && $a) {
                $delay = $a - $p;
            }
        }

        $cancelled = false;
        $notes = $row['echtzeitNotizen'] ?? [];
        if (is_array($notes)) {
            foreach ($notes as $n) {
                $text = is_array($n) ? (string) ($n['text'] ?? '') : (string) $n;
                if (stripos($text, 'entfällt') !== false || stripos($text, 'cancelled') !== false) {
                    $cancelled = true;
                    break;
                }
            }
        }

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

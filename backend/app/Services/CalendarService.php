<?php

namespace App\Services;

use App\Models\PanelSetting;
use App\Support\SnapshotCache;
use Carbon\Carbon;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class CalendarService
{
    private const WEEKDAY_MAP = [
        'SU' => Carbon::SUNDAY,
        'MO' => Carbon::MONDAY,
        'TU' => Carbon::TUESDAY,
        'WE' => Carbon::WEDNESDAY,
        'TH' => Carbon::THURSDAY,
        'FR' => Carbon::FRIDAY,
        'SA' => Carbon::SATURDAY,
    ];

    /**
     * @return array{events: list<array<string, mixed>>, configured: bool, error?: string}
     */
    public function events(?Carbon $from = null, ?Carbon $to = null): array
    {
        $url = PanelSetting::getValue('calendar_ical_url');
        if (!is_string($url) || trim($url) === '') {
            return ['events' => [], 'configured' => false];
        }

        $url = trim($url);
        $from ??= Carbon::now()->startOfDay();
        $to ??= Carbon::now()->addDays(14)->endOfDay();

        $ics = SnapshotCache::get($this->icsKey($url));
        if (!is_string($ics) || $ics === '') {
            return [
                'events' => [],
                'configured' => true,
                'error' => 'Kalender noch nicht geladen',
            ];
        }

        try {
            return ['events' => $this->parseEvents($ics, $from, $to), 'configured' => true];
        } catch (\Throwable $e) {
            return [
                'events' => [],
                'configured' => true,
                'error' => $e->getMessage(),
            ];
        }
    }

    /**
     * Holt den iCal-Feed. Nur Scheduler / CLI.
     *
     * @return array{events: list<array<string, mixed>>, configured: bool, error?: string}
     */
    public function refresh(?Carbon $from = null, ?Carbon $to = null): array
    {
        $url = PanelSetting::getValue('calendar_ical_url');
        if (!is_string($url) || trim($url) === '') {
            return ['events' => [], 'configured' => false];
        }

        $url = trim($url);
        $from ??= Carbon::now('Europe/Berlin')->startOfMonth()->subDays(7)->startOfDay();
        $to ??= Carbon::now('Europe/Berlin')->endOfMonth()->addDays(7)->endOfDay();

        try {
            $ics = $this->downloadIcs($url);
            SnapshotCache::put($this->icsKey($url), $ics);

            return ['events' => $this->parseEvents($ics, $from, $to), 'configured' => true];
        } catch (\Throwable $e) {
            $stale = $this->events($from, $to);
            if (($stale['events'] ?? []) !== []) {
                return $stale;
            }

            return [
                'events' => [],
                'configured' => true,
                'error' => $e->getMessage(),
            ];
        }
    }

    private function icsKey(string $url): string
    {
        return 'calendar_ics_' . sha1($url);
    }

    private function downloadIcs(string $url): string
    {
        if (!filter_var($url, FILTER_VALIDATE_URL)) {
            throw new RuntimeException('Ungültige iCal-URL');
        }

        $scheme = strtolower((string) parse_url($url, PHP_URL_SCHEME));
        if (!in_array($scheme, ['http', 'https'], true)) {
            throw new RuntimeException('iCal-URL muss http(s) sein');
        }

        $response = Http::timeout(8)
            ->withHeaders(['Accept' => 'text/calendar, text/plain, */*'])
            ->get($url);

        if (!$response->successful()) {
            throw new RuntimeException('Kalender-Feed nicht erreichbar (HTTP ' . $response->status() . ')');
        }

        $body = $response->body();
        if (!str_contains($body, 'BEGIN:VCALENDAR') && !str_contains($body, 'BEGIN:VEVENT')) {
            throw new RuntimeException('Antwort ist kein gültiger iCal-Feed');
        }

        return $body;
    }

    /**
     * @return list<array{uid: string, title: string, start: string, end: string|null, all_day: bool}>
     */
    private function parseEvents(string $ics, Carbon $from, Carbon $to): array
    {
        $unfolded = preg_replace("/\r\n[ \t]/", '', str_replace("\r\n", "\n", $ics)) ?? $ics;
        $blocks = [];
        if (preg_match_all('/BEGIN:VEVENT(.*?)END:VEVENT/s', $unfolded, $matches)) {
            $blocks = $matches[1];
        }

        $events = [];
        foreach ($blocks as $block) {
            $props = $this->parseProps($block);
            $dtStart = $props['DTSTART'] ?? null;
            if ($dtStart === null) {
                continue;
            }

            $start = $this->parseDateTime($dtStart['value'], $dtStart['params']);
            if ($start === null) {
                continue;
            }

            $allDay = $this->isAllDay($dtStart['params'], $dtStart['value']);
            $end = null;
            if (isset($props['DTEND'])) {
                $end = $this->parseDateTime($props['DTEND']['value'], $props['DTEND']['params']);
                if ($allDay && $end !== null) {
                    $end = $end->copy()->subSecond();
                }
            } elseif (isset($props['DURATION'])) {
                $end = $this->applyDuration($start, $props['DURATION']['value']);
            } else {
                $end = $allDay ? $start->copy()->endOfDay() : $start->copy()->addHour();
            }

            $title = $this->unescape($props['SUMMARY']['value'] ?? 'Termin');
            $uid = $props['UID']['value'] ?? ($start->toIso8601String() . '|' . $title);
            $durationSeconds = $end ? $start->diffInSeconds($end, false) : ($allDay ? 86399 : 3600);
            if ($durationSeconds < 0) {
                $durationSeconds = abs($durationSeconds);
            }

            $exdates = $this->parseExdates($props, $block);
            $rrule = isset($props['RRULE']) ? $this->parseRrule($props['RRULE']['value']) : null;

            if ($rrule === null) {
                $rangeEnd = $end ?? $start;
                if ($rangeEnd->lt($from) || $start->gt($to)) {
                    continue;
                }
                $events[] = $this->makeEvent($uid, $title, $start, $end, $allDay);
                continue;
            }

            foreach ($this->expandRrule($start, $rrule, $from, $to, $exdates) as $occurrence) {
                $occEnd = $occurrence->copy()->addSeconds($durationSeconds);
                $events[] = $this->makeEvent(
                    $uid . '_' . $occurrence->format('Ymd'),
                    $title,
                    $occurrence,
                    $occEnd,
                    $allDay,
                );
            }
        }

        usort($events, fn ($a, $b) => strcmp($a['start'], $b['start']));

        return array_values($events);
    }

    /**
     * @return array{uid: string, title: string, start: string, end: string|null, all_day: bool}
     */
    private function makeEvent(string $uid, string $title, Carbon $start, ?Carbon $end, bool $allDay): array
    {
        return [
            'uid' => $uid,
            'title' => $title,
            'start' => $start->toIso8601String(),
            'end' => $end ? $end->toIso8601String() : null,
            'all_day' => $allDay,
        ];
    }

    /**
     * @return array{freq: string, interval: int, until: ?Carbon, count: ?int, byday: list<string>}
     */
    private function parseRrule(string $value): array
    {
        $parts = [];
        foreach (explode(';', $value) as $part) {
            if (!str_contains($part, '=')) {
                continue;
            }
            [$k, $v] = explode('=', $part, 2);
            $parts[strtoupper(trim($k))] = trim($v);
        }

        $until = null;
        if (!empty($parts['UNTIL'])) {
            $until = $this->parseDateTime($parts['UNTIL'], str_ends_with($parts['UNTIL'], 'Z') ? [] : []);
        }

        $byday = [];
        if (!empty($parts['BYDAY'])) {
            foreach (explode(',', $parts['BYDAY']) as $d) {
                $d = strtoupper(preg_replace('/[^A-Z]/', '', $d) ?? '');
                if (isset(self::WEEKDAY_MAP[$d])) {
                    $byday[] = $d;
                }
            }
        }

        return [
            'freq' => strtoupper($parts['FREQ'] ?? 'DAILY'),
            'interval' => max(1, (int) ($parts['INTERVAL'] ?? 1)),
            'until' => $until,
            'count' => isset($parts['COUNT']) ? max(1, (int) $parts['COUNT']) : null,
            'byday' => $byday,
        ];
    }

    /**
     * Collect EXDATE values (may appear multiple times in ICS — last parseProps wins; also scan raw).
     *
     * @param  array<string, array{value: string, params: array<string, string>}>  $props
     * @return list<string> Ymd keys
     */
    private function parseExdates(array $props, string $block): array
    {
        $keys = [];
        if (isset($props['EXDATE'])) {
            foreach (explode(',', $props['EXDATE']['value']) as $raw) {
                $dt = $this->parseDateTime(trim($raw), $props['EXDATE']['params']);
                if ($dt) {
                    $keys[] = $dt->format('Ymd');
                }
            }
        }
        // Multiple EXDATE lines
        if (preg_match_all('/^EXDATE[^:]*:(.+)$/mi', $block, $m)) {
            foreach ($m[1] as $line) {
                foreach (explode(',', trim($line)) as $raw) {
                    $dt = $this->parseDateTime(trim($raw), []);
                    if ($dt) {
                        $keys[] = $dt->format('Ymd');
                    }
                }
            }
        }

        return array_values(array_unique($keys));
    }

    /**
     * @param  array{freq: string, interval: int, until: ?Carbon, count: ?int, byday: list<string>}  $rrule
     * @param  list<string>  $exdates
     * @return list<Carbon>
     */
    private function expandRrule(Carbon $dtStart, array $rrule, Carbon $from, Carbon $to, array $exdates): array
    {
        $occurrences = [];
        $countLimit = $rrule['count'] ?? PHP_INT_MAX;
        $until = $rrule['until'];
        $interval = $rrule['interval'];
        $freq = $rrule['freq'];

        $windowEnd = $to->copy();
        if ($until !== null && $until->lt($windowEnd)) {
            $windowEnd = $until->copy();
        }

        $cursor = $dtStart->copy();
        // Jump close to the visible window so old series still expand in short ranges (widget = 14 Tage).
        $this->fastForwardCursor($cursor, $dtStart, $from, $freq, $interval);

        $inWindow = 0;
        $guard = 0;
        $maxGuard = 5000;
        $maxInWindow = 500;

        while ($inWindow < $maxInWindow && $guard < $maxGuard) {
            $guard++;

            if ($cursor->gt($windowEnd->copy()->addWeek())) {
                break;
            }

            $candidates = $this->occurrenceCandidates($cursor, $dtStart, $freq, $rrule['byday']);

            foreach ($candidates as $cand) {
                if ($cand->lt($dtStart)) {
                    continue;
                }
                if ($until !== null && $cand->gt($until)) {
                    continue;
                }
                if ($cand->gt($windowEnd)) {
                    continue;
                }
                if (in_array($cand->format('Ymd'), $exdates, true)) {
                    continue;
                }

                // COUNT applies to series from DTSTART, including before window
                $seriesIndex = $this->estimateSeriesIndex($dtStart, $cand, $freq, $interval, $rrule['byday']);
                if ($countLimit !== PHP_INT_MAX && $seriesIndex >= $countLimit) {
                    continue;
                }

                $overlapsWindow = $cand->lte($to) && ($cand->copy()->endOfDay()->gte($from) || $cand->gte($from));
                if (!$overlapsWindow) {
                    continue;
                }

                $key = $cand->format('YmdHis');
                if (!isset($occurrences[$key])) {
                    $occurrences[$key] = $cand->copy();
                    $inWindow++;
                }
            }

            // Advance cursor by interval
            if ($freq === 'WEEKLY') {
                $cursor->addWeeks($interval);
            } elseif ($freq === 'MONTHLY') {
                $cursor->addMonthsNoOverflow($interval);
            } elseif ($freq === 'YEARLY') {
                $cursor->addYears($interval);
            } else {
                $cursor->addDays($interval);
            }
        }

        ksort($occurrences);

        return array_values($occurrences);
    }

    /**
     * Move cursor forward in INTERVAL steps to just before $from (keeps alignment with DTSTART).
     */
    private function fastForwardCursor(Carbon $cursor, Carbon $dtStart, Carbon $from, string $freq, int $interval): void
    {
        if (!$cursor->copy()->endOfDay()->lt($from)) {
            return;
        }

        $interval = max(1, $interval);

        if ($freq === 'WEEKLY') {
            $weeks = (int) floor($dtStart->diffInDays($from) / 7);
            $steps = intdiv(max(0, $weeks - 1), $interval);
            if ($steps > 0) {
                $cursor->addWeeks($steps * $interval);
            }

            return;
        }

        if ($freq === 'MONTHLY') {
            $months = ($from->year - $dtStart->year) * 12 + ($from->month - $dtStart->month);
            $steps = intdiv(max(0, $months - 1), $interval);
            if ($steps > 0) {
                $cursor->addMonthsNoOverflow($steps * $interval);
            }

            return;
        }

        if ($freq === 'YEARLY') {
            $years = $from->year - $dtStart->year;
            $steps = intdiv(max(0, $years - 1), $interval);
            if ($steps > 0) {
                $cursor->addYears($steps * $interval);
            }

            return;
        }

        // DAILY (default)
        $days = (int) $dtStart->diffInDays($from);
        $steps = intdiv(max(0, $days - 1), $interval);
        if ($steps > 0) {
            $cursor->addDays($steps * $interval);
        }
    }

    /**
     * @param  list<string>  $byday
     * @return list<Carbon>
     */
    private function occurrenceCandidates(Carbon $cursor, Carbon $dtStart, string $freq, array $byday): array
    {
        if ($freq === 'WEEKLY' && $byday !== []) {
            $weekStart = $cursor->copy()->startOfWeek(Carbon::MONDAY);
            $out = [];
            foreach ($byday as $code) {
                $dow = self::WEEKDAY_MAP[$code];
                $d = $weekStart->copy();
                while ($d->dayOfWeek !== $dow) {
                    $d->addDay();
                }
                // Preserve time from DTSTART
                $d->setTime($dtStart->hour, $dtStart->minute, $dtStart->second);
                $out[] = $d;
            }

            return $out;
        }

        if ($freq === 'WEEKLY' && $byday === []) {
            // Same weekday as DTSTART
            $d = $cursor->copy()->setTime($dtStart->hour, $dtStart->minute, $dtStart->second);
            // Align to same day-of-week as start within this week bucket
            $target = $dtStart->dayOfWeek;
            $weekStart = $cursor->copy()->startOfWeek(Carbon::MONDAY);
            $d = $weekStart->copy();
            while ($d->dayOfWeek !== $target) {
                $d->addDay();
            }
            $d->setTime($dtStart->hour, $dtStart->minute, $dtStart->second);

            return [$d];
        }

        // DAILY / MONTHLY / YEARLY / default: one candidate at cursor with DTSTART time
        $d = $cursor->copy()->setTime($dtStart->hour, $dtStart->minute, $dtStart->second);

        return [$d];
    }

    /**
     * Rough index for COUNT filtering (0-based from DTSTART).
     *
     * @param  list<string>  $byday
     */
    private function estimateSeriesIndex(Carbon $dtStart, Carbon $cand, string $freq, int $interval, array $byday): int
    {
        if ($freq === 'WEEKLY') {
            $weeks = (int) floor($dtStart->diffInDays($cand) / 7);
            return (int) floor($weeks / max(1, $interval));
        }
        if ($freq === 'MONTHLY') {
            $months = ($cand->year - $dtStart->year) * 12 + ($cand->month - $dtStart->month);

            return (int) floor($months / max(1, $interval));
        }
        if ($freq === 'YEARLY') {
            return (int) floor(($cand->year - $dtStart->year) / max(1, $interval));
        }
        $days = (int) $dtStart->diffInDays($cand);

        return (int) floor($days / max(1, $interval));
    }

    /**
     * @return array<string, array{value: string, params: array<string, string>}>
     */
    private function parseProps(string $block): array
    {
        $props = [];
        foreach (explode("\n", trim($block)) as $line) {
            $line = trim($line);
            if ($line === '' || !str_contains($line, ':')) {
                continue;
            }
            [$left, $value] = explode(':', $line, 2);
            $parts = explode(';', $left);
            $name = strtoupper(array_shift($parts));
            $params = [];
            foreach ($parts as $part) {
                if (!str_contains($part, '=')) {
                    continue;
                }
                [$pk, $pv] = explode('=', $part, 2);
                $params[strtoupper($pk)] = $pv;
            }
            // Keep first for most; for EXDATE merge would be better — last wins for RRULE
            if ($name === 'EXDATE' && isset($props['EXDATE'])) {
                $props['EXDATE']['value'] .= ',' . $value;
            } else {
                $props[$name] = ['value' => $value, 'params' => $params];
            }
        }

        return $props;
    }

    /**
     * @param  array<string, string>  $params
     */
    private function parseDateTime(string $value, array $params): ?Carbon
    {
        $value = trim($value);
        $tz = $params['TZID'] ?? null;

        try {
            if (preg_match('/^\d{8}$/', $value)) {
                return Carbon::createFromFormat('Ymd', $value, $tz ?: config('app.timezone'))->startOfDay();
            }
            if (preg_match('/^\d{8}T\d{6}Z$/', $value)) {
                return Carbon::createFromFormat('Ymd\THis\Z', $value, 'UTC')->timezone(config('app.timezone'));
            }
            if (preg_match('/^\d{8}T\d{6}$/', $value)) {
                return Carbon::createFromFormat('Ymd\THis', $value, $tz ?: config('app.timezone'));
            }
        } catch (\Throwable) {
            return null;
        }

        return null;
    }

    /**
     * @param  array<string, string>  $params
     */
    private function isAllDay(array $params, string $value): bool
    {
        if (isset($params['VALUE']) && strtoupper($params['VALUE']) === 'DATE') {
            return true;
        }

        return (bool) preg_match('/^\d{8}$/', trim($value));
    }

    private function applyDuration(Carbon $start, string $duration): Carbon
    {
        $end = $start->copy();
        if (preg_match('/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/', $duration, $m)) {
            if (!empty($m[1])) {
                $end->addDays((int) $m[1]);
            }
            if (!empty($m[2])) {
                $end->addHours((int) $m[2]);
            }
            if (!empty($m[3])) {
                $end->addMinutes((int) $m[3]);
            }
            if (!empty($m[4])) {
                $end->addSeconds((int) $m[4]);
            }
        }

        return $end;
    }

    private function unescape(string $value): string
    {
        return str_replace(
            ['\\\\', '\\;', '\\,', '\\n', '\\N'],
            ['\\', ';', ',', "\n", "\n"],
            $value
        );
    }
}

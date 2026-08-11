<?php

namespace App\Services;

use App\Models\PanelSetting;
use Carbon\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class CalendarService
{
    private const CACHE_TTL_SECONDS = 900; // 15 Min

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

        try {
            $ics = $this->fetchIcs($url);
            $events = $this->parseEvents($ics, $from, $to);

            return ['events' => $events, 'configured' => true];
        } catch (\Throwable $e) {
            return [
                'events' => [],
                'configured' => true,
                'error' => $e->getMessage(),
            ];
        }
    }

    private function fetchIcs(string $url): string
    {
        $cacheKey = 'calendar_ics_' . sha1($url);

        return Cache::remember($cacheKey, self::CACHE_TTL_SECONDS, function () use ($url) {
            if (!filter_var($url, FILTER_VALIDATE_URL)) {
                throw new RuntimeException('Ungültige iCal-URL');
            }

            $scheme = strtolower((string) parse_url($url, PHP_URL_SCHEME));
            if (!in_array($scheme, ['http', 'https'], true)) {
                throw new RuntimeException('iCal-URL muss http(s) sein');
            }

            $response = Http::timeout(20)
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
        });
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
                // All-day DTEND is exclusive in iCal — show as previous day end for display range
                if ($allDay && $end !== null) {
                    $end = $end->copy()->subSecond();
                }
            } elseif (isset($props['DURATION'])) {
                $end = $this->applyDuration($start, $props['DURATION']['value']);
            } else {
                $end = $allDay ? $start->copy()->endOfDay() : $start->copy()->addHour();
            }

            $rangeEnd = $end ?? $start;
            // Include if event overlaps [from, to]
            if ($rangeEnd->lt($from) || $start->gt($to)) {
                continue;
            }

            $title = $this->unescape($props['SUMMARY']['value'] ?? 'Termin');
            $uid = $props['UID']['value'] ?? ($start->toIso8601String() . '|' . $title);

            $events[] = [
                'uid' => $uid,
                'title' => $title,
                'start' => $start->toIso8601String(),
                'end' => $end ? $end->toIso8601String() : null,
                'all_day' => $allDay,
            ];
        }

        usort($events, fn ($a, $b) => strcmp($a['start'], $b['start']));

        return array_values($events);
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
            // Prefer primary fields; skip overrides like DTSTART;TZID already in params
            $params = [];
            foreach ($parts as $part) {
                if (!str_contains($part, '=')) {
                    continue;
                }
                [$pk, $pv] = explode('=', $part, 2);
                $params[strtoupper($pk)] = $pv;
            }
            $props[$name] = ['value' => $value, 'params' => $params];
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

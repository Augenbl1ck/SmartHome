<?php

namespace App\Services;

use App\Models\Device;
use App\Models\EnergyDaily;
use App\Models\EnergySample;
use App\Models\PanelSetting;
use App\Support\SnapshotCache;
use Carbon\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;

class EnergyService
{
    private const DEFAULT_PRICE = 0.30;

    private const TZ = 'Europe/Berlin';

    /**
     * @return array<string, mixed>
     */
    public function overview(): array
    {
        $cached = SnapshotCache::get('energy_overview');
        if (is_array($cached)) {
            return $cached;
        }

        return $this->refreshOverview();
    }

    /**
     * Rechnet die Übersicht aus der DB neu. Scheduler oder Cache-Miss.
     *
     * @return array<string, mixed>
     */
    public function refreshOverview(): array
    {
        $data = $this->computeOverview();
        SnapshotCache::put('energy_overview', $data);

        return $data;
    }

    /**
     * @return array<string, mixed>
     */
    private function computeOverview(): array
    {
        $price = $this->pricePerKwh();
        $devices = $this->energyDevices();

        $liveW = 0.0;
        $deviceRows = [];
        foreach ($devices as $device) {
            $attrs = is_array($device->attributes) ? $device->attributes : [];
            $w = isset($attrs['power_w']) && is_numeric($attrs['power_w']) ? (float) $attrs['power_w'] : 0.0;
            $wh = isset($attrs['energy_wh']) && is_numeric($attrs['energy_wh']) ? (float) $attrs['energy_wh'] : null;
            $liveW += max(0, $w);
            $deviceRows[] = [
                'id' => $device->id,
                'name' => $device->name,
                'type' => $device->type,
                'power_w' => round($w, 1),
                'energy_wh' => $wh !== null ? round($wh, 1) : null,
            ];
        }

        $now = $this->berlinNow();

        $todayFrom = $now->copy()->startOfDay();
        $yesterdayFrom = $todayFrom->copy()->subDay();
        $yesterdayTo = $yesterdayFrom->copy()->setTimeFrom($now);

        $weekFrom = $todayFrom->copy()->subDays(6);
        $prevWeekFrom = $weekFrom->copy()->subDays(7);
        $prevWeekTo = $weekFrom->copy()->subDay()->setTimeFrom($now);

        $monthFrom = $now->copy()->startOfMonth();
        $prevMonthFrom = $monthFrom->copy()->subMonthNoOverflow();
        $prevMonthTo = $this->alignedPrevious($now, $prevMonthFrom);

        $yearFrom = $now->copy()->startOfYear();
        $prevYearFrom = $yearFrom->copy()->subYear();
        $prevYearTo = $now->copy()->subYear();

        $todayKwh = $this->kwhInRange($todayFrom, $now);
        $weekKwh = $this->kwhInRange($weekFrom, $now);
        $monthKwh = $this->kwhInRange($monthFrom, $now);
        $yearKwh = $this->kwhInRange($yearFrom, $now);

        $prevTodayKwh = $this->kwhInRange($yesterdayFrom, $yesterdayTo);
        $prevWeekKwh = $this->kwhInRange($prevWeekFrom, $prevWeekTo);
        $prevMonthKwh = $this->kwhInRange($prevMonthFrom, $prevMonthTo);
        $prevYearKwh = $this->kwhInRange($prevYearFrom, $prevYearTo);

        $byDevice = [
            'day' => $this->consumptionByDeviceRange($todayFrom, $now),
            'week' => $this->consumptionByDeviceRange($weekFrom, $now),
            'month' => $this->consumptionByDeviceRange($monthFrom, $now),
            'year' => $this->consumptionByDeviceRange($yearFrom, $now),
        ];

        $hasData = $devices->isNotEmpty()
            || EnergySample::query()->exists()
            || EnergyDaily::query()->exists();

        return [
            'configured' => $hasData,
            'price_per_kwh' => $price,
            'live_power_w' => round($liveW, 1),
            'today_kwh' => round($todayKwh, 3),
            'week_kwh' => round($weekKwh, 3),
            'month_kwh' => round($monthKwh, 3),
            'year_kwh' => round($yearKwh, 3),
            'today_cost' => round($todayKwh * $price, 2),
            'week_cost' => round($weekKwh * $price, 2),
            'month_cost' => round($monthKwh * $price, 2),
            'year_cost' => round($yearKwh * $price, 2),
            'prev_today_kwh' => round($prevTodayKwh, 3),
            'prev_week_kwh' => round($prevWeekKwh, 3),
            'prev_month_kwh' => round($prevMonthKwh, 3),
            'prev_year_kwh' => round($prevYearKwh, 3),
            'prev_today_cost' => round($prevTodayKwh * $price, 2),
            'prev_week_cost' => round($prevWeekKwh * $price, 2),
            'prev_month_cost' => round($prevMonthKwh * $price, 2),
            'prev_year_cost' => round($prevYearKwh * $price, 2),
            'devices' => $deviceRows,
            'by_device' => $byDevice,
            'by_device_today' => $byDevice['day'],
            'sampled_at' => EnergySample::query()->max('recorded_at'),
            'data_since' => $this->dataSince(),
        ];
    }

    /**
     * @return array{range: string, buckets: list<array<string, mixed>>, price_per_kwh: float, data_since: ?string}
     */
    public function history(string $range): array
    {
        $allowed = ['day', 'week', 'month', 'year'];
        if (!in_array($range, $allowed, true)) {
            $range = 'day';
        }

        $price = $this->pricePerKwh();
        $buckets = match ($range) {
            'week' => $this->weekBuckets($price),
            'month' => $this->monthBuckets($price),
            'year' => $this->yearBuckets($price),
            default => $this->dayBuckets($price),
        };

        return [
            'range' => $range,
            'buckets' => $buckets,
            'price_per_kwh' => $price,
            'data_since' => $this->dataSince(),
        ];
    }

    public function pricePerKwh(): float
    {
        $raw = PanelSetting::getValue('energy');
        if (is_array($raw) && isset($raw['price_per_kwh']) && is_numeric($raw['price_per_kwh'])) {
            $p = (float) $raw['price_per_kwh'];
            if ($p >= 0 && $p <= 10) {
                return round($p, 4);
            }
        }

        return self::DEFAULT_PRICE;
    }

    public function hasDailyRows(): bool
    {
        return EnergyDaily::query()->exists();
    }

    /**
     * One-time backfill of energy_daily from remaining samples.
     *
     * @return int Number of calendar days processed
     */
    public function backfillDailyFromSamples(): int
    {
        $min = EnergySample::query()->min('recorded_at');
        if ($min === null) {
            return 0;
        }

        $start = Carbon::parse($min)->timezone(self::TZ)->startOfDay();
        $end = $this->berlinNow()->startOfDay();
        $count = 0;

        for ($d = $start->copy(); $d->lte($end); $d->addDay()) {
            $this->upsertDay($d);
            $count++;
        }

        return $count;
    }

    public function rollupRecentDays(): void
    {
        $today = $this->berlinNow()->startOfDay();
        $this->upsertDay($today->copy()->subDay());
        $this->upsertDay($today);
    }

    /**
     * @return \Illuminate\Support\Collection<int, Device>
     */
    private function energyDevices(): Collection
    {
        return Device::query()
            ->where('active', true)
            ->get()
            ->filter(function (Device $d) {
                $attrs = is_array($d->attributes) ? $d->attributes : [];

                return (isset($attrs['power_w']) && is_numeric($attrs['power_w']))
                    || (isset($attrs['energy_wh']) && is_numeric($attrs['energy_wh']));
            })
            ->values();
    }

    private function berlinNow(): Carbon
    {
        return now()->timezone(self::TZ);
    }

    /**
     * Same clock time on a previous period start, capped to that month's last day.
     */
    private function alignedPrevious(Carbon $now, Carbon $prevPeriodStart): Carbon
    {
        $day = min((int) $now->format('j'), (int) $prevPeriodStart->copy()->endOfMonth()->format('j'));

        return $prevPeriodStart->copy()->day($day)->setTimeFrom($now);
    }

    private function dataSince(): ?string
    {
        $dailyMin = EnergyDaily::query()->min('day');
        $sampleMin = EnergySample::query()->min('recorded_at');

        $dates = [];
        if ($dailyMin) {
            $dates[] = Carbon::parse($dailyMin)->timezone(self::TZ)->toDateString();
        }
        if ($sampleMin) {
            $dates[] = Carbon::parse($sampleMin)->timezone(self::TZ)->toDateString();
        }
        if ($dates === []) {
            return null;
        }

        sort($dates);

        return $dates[0];
    }

    /**
     * Prefer 5-min samples when the range still sits inside the 90-day window;
     * otherwise sum durable daily rollups (plus today's live samples).
     */
    private function kwhInRange(Carbon $fromBerlin, Carbon $toBerlin): float
    {
        $now = $this->berlinNow();
        if ($toBerlin->greaterThan($now)) {
            $toBerlin = $now->copy();
        }
        if ($toBerlin->lessThanOrEqualTo($fromBerlin)) {
            return 0.0;
        }

        $fromUtc = $fromBerlin->copy()->utc();
        $toUtc = $toBerlin->copy()->utc();

        if ($fromUtc->greaterThanOrEqualTo(now()->subDays(90)->subHour()) || !EnergyDaily::query()->exists()) {
            return $this->consumptionKwh($fromUtc, $toUtc);
        }

        return $this->kwhFromDailyPlusToday($fromBerlin, $toBerlin);
    }

    private function kwhFromDailyPlusToday(Carbon $fromBerlin, Carbon $toBerlin): float
    {
        $now = $this->berlinNow();
        $todayStart = $now->copy()->startOfDay();
        $fromDay = $fromBerlin->copy()->startOfDay();
        $toDay = $toBerlin->copy()->startOfDay();

        $kwh = 0.0;
        $lastComplete = $toDay->copy();
        if ($toBerlin->greaterThan($todayStart)) {
            $lastComplete = $todayStart->copy()->subDay();
        }

        if ($fromDay->lte($lastComplete)) {
            $kwh += (float) EnergyDaily::query()
                ->whereBetween('day', [$fromDay->toDateString(), $lastComplete->toDateString()])
                ->sum('kwh');
        }

        if ($toBerlin->greaterThan($todayStart) && $fromBerlin->lessThan($now)) {
            $sampleFrom = $fromBerlin->greaterThan($todayStart) ? $fromBerlin : $todayStart;
            $kwh += $this->consumptionKwh($sampleFrom->copy()->utc(), $toBerlin->copy()->utc());
        }

        return $kwh;
    }

    private function consumptionKwh(Carbon $from, Carbon $to): float
    {
        if ($to->lessThanOrEqualTo($from)) {
            return 0.0;
        }

        $totalWh = 0.0;
        foreach ($this->sampleDeviceIds($from, $to) as $deviceId) {
            $totalWh += $this->deviceConsumptionWh((int) $deviceId, $from, $to);
        }

        return $totalWh / 1000.0;
    }

    /**
     * @return list<array{id: int, name: string, kwh: float, cost: float, share: float}>
     */
    private function consumptionByDeviceRange(Carbon $fromBerlin, Carbon $toBerlin): array
    {
        $now = $this->berlinNow();
        if ($toBerlin->greaterThan($now)) {
            $toBerlin = $now->copy();
        }
        if ($toBerlin->lessThanOrEqualTo($fromBerlin)) {
            return [];
        }

        $fromUtc = $fromBerlin->copy()->utc();
        $useSamples = $fromUtc->greaterThanOrEqualTo(now()->subDays(90)->subHour())
            || !EnergyDaily::query()->exists();

        $kwhByDevice = $useSamples
            ? $this->deviceKwhMap($fromUtc, $toBerlin->copy()->utc())
            : $this->deviceKwhMapFromDaily($fromBerlin, $toBerlin);

        return $this->shareRows($kwhByDevice);
    }

    /**
     * @return array<int, float>
     */
    private function deviceKwhMap(Carbon $from, Carbon $to): array
    {
        $map = [];
        foreach ($this->sampleDeviceIds($from, $to) as $deviceId) {
            $wh = $this->deviceConsumptionWh((int) $deviceId, $from, $to);
            if ($wh <= 0) {
                continue;
            }
            $map[(int) $deviceId] = $wh / 1000.0;
        }

        return $map;
    }

    /**
     * @return array<int, float>
     */
    private function deviceKwhMapFromDaily(Carbon $fromBerlin, Carbon $toBerlin): array
    {
        $now = $this->berlinNow();
        $todayStart = $now->copy()->startOfDay();
        $fromDay = $fromBerlin->copy()->startOfDay();
        $toDay = $toBerlin->copy()->startOfDay();

        $map = [];
        $lastComplete = $toDay->copy();
        if ($toBerlin->greaterThan($todayStart)) {
            $lastComplete = $todayStart->copy()->subDay();
        }

        if ($fromDay->lte($lastComplete)) {
            $rows = EnergyDaily::query()
                ->whereBetween('day', [$fromDay->toDateString(), $lastComplete->toDateString()])
                ->selectRaw('device_id, SUM(kwh) as total_kwh')
                ->groupBy('device_id')
                ->get();
            foreach ($rows as $row) {
                $kwh = (float) $row->total_kwh;
                if ($kwh > 0) {
                    $map[(int) $row->device_id] = $kwh;
                }
            }
        }

        if ($toBerlin->greaterThan($todayStart) && $fromBerlin->lessThan($now)) {
            $sampleFrom = $fromBerlin->greaterThan($todayStart) ? $fromBerlin : $todayStart;
            foreach ($this->deviceKwhMap($sampleFrom->copy()->utc(), $toBerlin->copy()->utc()) as $id => $kwh) {
                $map[$id] = ($map[$id] ?? 0) + $kwh;
            }
        }

        return $map;
    }

    /**
     * @param  array<int, float>  $kwhByDevice
     * @return list<array{id: int, name: string, kwh: float, cost: float, share: float}>
     */
    private function shareRows(array $kwhByDevice): array
    {
        $price = $this->pricePerKwh();
        $sumKwh = array_sum($kwhByDevice);
        if ($kwhByDevice === []) {
            return [];
        }
        $names = Device::query()
            ->whereIn('id', array_keys($kwhByDevice))
            ->pluck('name', 'id');

        $rows = [];
        foreach ($kwhByDevice as $id => $kwh) {
            if ($kwh <= 0) {
                continue;
            }
            $rows[] = [
                'id' => (int) $id,
                'name' => $names[$id] ?? ('Gerät #' . $id),
                'kwh' => round($kwh, 3),
                'cost' => round($kwh * $price, 2),
                'share' => 0.0,
            ];
        }

        usort($rows, fn ($a, $b) => $b['kwh'] <=> $a['kwh']);
        foreach ($rows as &$r) {
            $r['share'] = $sumKwh > 0 ? round($r['kwh'] / $sumKwh, 3) : 0.0;
        }
        unset($r);

        return $rows;
    }

    /**
     * @return \Illuminate\Support\Collection<int, mixed>
     */
    private function sampleDeviceIds(Carbon $from, Carbon $to): Collection
    {
        return EnergySample::query()
            ->whereBetween('recorded_at', [$from, $to])
            ->distinct()
            ->pluck('device_id');
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function dayBuckets(float $price): array
    {
        $dayStart = $this->berlinNow()->startOfDay();
        $now = $this->berlinNow();
        $buckets = [];
        for ($h = 0; $h < 24; $h++) {
            $from = $dayStart->copy()->addHours($h);
            $to = $from->copy()->addHour();
            if ($from->greaterThan($now)) {
                break;
            }
            $end = $to->greaterThan($now) ? $now : $to;
            $kwh = $this->consumptionKwh($from->copy()->utc(), $end->copy()->utc());
            $avgW = $this->avgPowerW($from->copy()->utc(), $end->copy()->utc());
            $buckets[] = $this->bucket($from->format('H:i'), $from, $kwh, $avgW, $price);
        }

        return $buckets;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function weekBuckets(float $price): array
    {
        $start = $this->berlinNow()->startOfDay()->subDays(6);
        $now = $this->berlinNow();
        $buckets = [];
        for ($i = 0; $i < 7; $i++) {
            $dayStart = $start->copy()->addDays($i);
            $dayEnd = $dayStart->copy()->endOfDay();
            $end = $dayEnd->greaterThan($now) ? $now : $dayEnd;
            $kwh = $this->kwhInRange($dayStart, $end);
            $avgW = $this->avgPowerW($dayStart->copy()->utc(), $end->copy()->utc());
            $buckets[] = $this->bucket(
                $dayStart->copy()->locale('de')->isoFormat('dd D.M.'),
                $dayStart,
                $kwh,
                $avgW,
                $price
            );
        }

        return $buckets;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function monthBuckets(float $price): array
    {
        $monthStart = $this->berlinNow()->startOfMonth();
        $today = $this->berlinNow()->startOfDay();
        $now = $this->berlinNow();
        $daysInMonth = (int) $monthStart->copy()->endOfMonth()->format('j');
        $daily = $this->dailyKwhByDay(
            $monthStart->toDateString(),
            $today->copy()->subDay()->toDateString()
        );

        $buckets = [];
        for ($d = 0; $d < $daysInMonth; $d++) {
            $dayStart = $monthStart->copy()->addDays($d);
            if ($dayStart->greaterThan($today)) {
                break;
            }
            $dayKey = $dayStart->toDateString();
            if ($dayStart->equalTo($today) || !isset($daily[$dayKey])) {
                $dayEnd = $dayStart->copy()->endOfDay();
                $end = $dayEnd->greaterThan($now) ? $now : $dayEnd;
                $kwh = $this->consumptionKwh($dayStart->copy()->utc(), $end->copy()->utc());
                $avgW = $this->avgPowerW($dayStart->copy()->utc(), $end->copy()->utc());
            } else {
                $kwh = $daily[$dayKey];
                $avgW = $this->avgPowerW($dayStart->copy()->utc(), $dayStart->copy()->endOfDay()->utc());
            }
            $buckets[] = $this->bucket((string) ((int) $dayStart->format('j')), $dayStart, $kwh, $avgW, $price);
        }

        return $buckets;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function yearBuckets(float $price): array
    {
        $yearStart = $this->berlinNow()->startOfYear();
        $now = $this->berlinNow();
        $buckets = [];
        for ($m = 0; $m < 12; $m++) {
            $monthStart = $yearStart->copy()->addMonths($m);
            if ($monthStart->greaterThan($now)) {
                break;
            }
            $monthEnd = $monthStart->copy()->endOfMonth();
            $end = $monthEnd->greaterThan($now) ? $now : $monthEnd;
            $kwh = $this->kwhInRange($monthStart, $end);
            $avgW = $this->avgPowerW($monthStart->copy()->utc(), $end->copy()->utc());
            $buckets[] = $this->bucket(
                $monthStart->copy()->locale('de')->isoFormat('MMM'),
                $monthStart,
                $kwh,
                $avgW,
                $price
            );
        }

        return $buckets;
    }

    /**
     * @return array<string, float>
     */
    private function dailyKwhByDay(string $fromDay, string $toDay): array
    {
        if ($fromDay > $toDay) {
            return [];
        }

        $rows = EnergyDaily::query()
            ->whereBetween('day', [$fromDay, $toDay])
            ->selectRaw('day, SUM(kwh) as total_kwh')
            ->groupBy('day')
            ->get();

        $map = [];
        foreach ($rows as $row) {
            $key = Carbon::parse($row->day)->toDateString();
            $map[$key] = (float) $row->total_kwh;
        }

        return $map;
    }

    /**
     * @return array{label: string, start: string, kwh: float, avg_w: float, cost: float}
     */
    private function bucket(string $label, Carbon $start, float $kwh, float $avgW, float $price): array
    {
        return [
            'label' => $label,
            'start' => $start->toIso8601String(),
            'kwh' => round($kwh, 3),
            'avg_w' => round($avgW, 1),
            'cost' => round($kwh * $price, 2),
        ];
    }

    private function upsertDay(Carbon $dayBerlin): void
    {
        $dayStart = $dayBerlin->copy()->timezone(self::TZ)->startOfDay();
        $dayEnd = $dayStart->copy()->endOfDay();
        $now = $this->berlinNow();
        $end = $dayEnd->greaterThan($now) ? $now : $dayEnd;
        if ($end->lessThanOrEqualTo($dayStart)) {
            return;
        }

        $fromUtc = $dayStart->copy()->utc();
        $toUtc = $end->copy()->utc();
        $dayStr = $dayStart->toDateString();

        $deviceIds = $this->sampleDeviceIds($fromUtc, $toUtc);
        foreach ($deviceIds as $deviceId) {
            $wh = $this->deviceConsumptionWh((int) $deviceId, $fromUtc, $toUtc);
            EnergyDaily::query()->upsert(
                [[
                    'device_id' => (int) $deviceId,
                    'day' => $dayStr,
                    'kwh' => round($wh / 1000.0, 4),
                ]],
                ['device_id', 'day'],
                ['kwh']
            );
        }
    }

    private function deviceConsumptionWh(int $deviceId, Carbon $from, Carbon $to): float
    {
        $samples = EnergySample::query()
            ->where('device_id', $deviceId)
            ->whereBetween('recorded_at', [$from, $to])
            ->orderBy('recorded_at')
            ->get(['power_w', 'energy_wh', 'recorded_at']);

        if ($samples->isEmpty()) {
            return 0.0;
        }

        $withWh = $samples->filter(fn ($s) => $s->energy_wh !== null);
        if ($withWh->count() >= 2) {
            $min = (float) $withWh->min('energy_wh');
            $max = (float) $withWh->max('energy_wh');
            $delta = $max - $min;
            if ($delta >= 0 && $delta < 1_000_000) {
                return $delta;
            }
        }

        $wh = 0.0;
        $prev = null;
        foreach ($samples as $s) {
            if ($prev !== null && $prev->power_w !== null && $s->recorded_at) {
                $hours = $prev->recorded_at->diffInSeconds($s->recorded_at) / 3600.0;
                if ($hours > 0 && $hours < 2) {
                    $wh += max(0, (float) $prev->power_w) * $hours;
                }
            }
            $prev = $s;
        }

        return $wh;
    }

    private function avgPowerW(Carbon $from, Carbon $to): float
    {
        $avg = EnergySample::query()
            ->whereBetween('recorded_at', [$from, $to])
            ->whereNotNull('power_w')
            ->avg('power_w');

        return $avg !== null ? (float) $avg : 0.0;
    }
}

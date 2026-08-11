<?php

namespace App\Services;

use App\Models\Device;
use App\Models\EnergySample;
use App\Models\PanelSetting;
use Carbon\Carbon;

class EnergyService
{
    private const DEFAULT_PRICE = 0.30;

    /**
     * @return array<string, mixed>
     */
    public function overview(): array
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

        $todayStart = now()->timezone('Europe/Berlin')->startOfDay()->utc();
        $weekStart = now()->timezone('Europe/Berlin')->startOfDay()->subDays(6)->utc();
        $now = now();

        $todayKwh = $this->consumptionKwh($todayStart, $now);
        $weekKwh = $this->consumptionKwh($weekStart, $now);
        $byDeviceToday = $this->consumptionByDevice($todayStart, $now);

        $hasData = $devices->isNotEmpty() || EnergySample::query()->exists();

        return [
            'configured' => $hasData,
            'price_per_kwh' => $price,
            'live_power_w' => round($liveW, 1),
            'today_kwh' => round($todayKwh, 3),
            'week_kwh' => round($weekKwh, 3),
            'today_cost' => round($todayKwh * $price, 2),
            'week_cost' => round($weekKwh * $price, 2),
            'devices' => $deviceRows,
            'by_device_today' => $byDeviceToday,
            'sampled_at' => EnergySample::query()->max('recorded_at'),
        ];
    }

    /**
     * @return array{range: string, buckets: list<array<string, mixed>>, price_per_kwh: float}
     */
    public function history(string $range): array
    {
        $range = $range === 'week' ? 'week' : 'day';
        $price = $this->pricePerKwh();
        $tz = 'Europe/Berlin';

        if ($range === 'week') {
            $start = now()->timezone($tz)->startOfDay()->subDays(6);
            $buckets = [];
            for ($i = 0; $i < 7; $i++) {
                $dayStart = $start->copy()->addDays($i);
                $dayEnd = $dayStart->copy()->endOfDay();
                $end = $dayEnd->greaterThan(now()->timezone($tz)) ? now()->timezone($tz) : $dayEnd;
                $kwh = $this->consumptionKwh($dayStart->copy()->utc(), $end->copy()->utc());
                $avgW = $this->avgPowerW($dayStart->copy()->utc(), $end->copy()->utc());
                $buckets[] = [
                    'label' => $dayStart->format('D d.m.'),
                    'start' => $dayStart->toIso8601String(),
                    'kwh' => round($kwh, 3),
                    'avg_w' => round($avgW, 1),
                    'cost' => round($kwh * $price, 2),
                ];
            }

            return ['range' => 'week', 'buckets' => $buckets, 'price_per_kwh' => $price];
        }

        $dayStart = now()->timezone($tz)->startOfDay();
        $buckets = [];
        for ($h = 0; $h < 24; $h++) {
            $from = $dayStart->copy()->addHours($h);
            $to = $from->copy()->addHour();
            if ($from->greaterThan(now()->timezone($tz))) {
                break;
            }
            $end = $to->greaterThan(now()->timezone($tz)) ? now()->timezone($tz) : $to;
            $kwh = $this->consumptionKwh($from->copy()->utc(), $end->copy()->utc());
            $avgW = $this->avgPowerW($from->copy()->utc(), $end->copy()->utc());
            $buckets[] = [
                'label' => $from->format('H:i'),
                'start' => $from->toIso8601String(),
                'kwh' => round($kwh, 3),
                'avg_w' => round($avgW, 1),
                'cost' => round($kwh * $price, 2),
            ];
        }

        return ['range' => 'day', 'buckets' => $buckets, 'price_per_kwh' => $price];
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

    /**
     * @return \Illuminate\Support\Collection<int, Device>
     */
    private function energyDevices()
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

    private function consumptionKwh(Carbon $from, Carbon $to): float
    {
        if ($to->lessThanOrEqualTo($from)) {
            return 0.0;
        }

        $deviceIds = EnergySample::query()
            ->whereBetween('recorded_at', [$from, $to])
            ->distinct()
            ->pluck('device_id');

        $totalWh = 0.0;
        foreach ($deviceIds as $deviceId) {
            $totalWh += $this->deviceConsumptionWh((int) $deviceId, $from, $to);
        }

        return $totalWh / 1000.0;
    }

    /**
     * @return list<array{id: int, name: string, kwh: float, cost: float, share: float}>
     */
    private function consumptionByDevice(Carbon $from, Carbon $to): array
    {
        $price = $this->pricePerKwh();
        $deviceIds = EnergySample::query()
            ->whereBetween('recorded_at', [$from, $to])
            ->distinct()
            ->pluck('device_id');

        $rows = [];
        $sumKwh = 0.0;
        foreach ($deviceIds as $deviceId) {
            $wh = $this->deviceConsumptionWh((int) $deviceId, $from, $to);
            if ($wh <= 0) {
                continue;
            }
            $kwh = $wh / 1000.0;
            $sumKwh += $kwh;
            $device = Device::find($deviceId);
            $rows[] = [
                'id' => (int) $deviceId,
                'name' => $device?->name ?? ('Gerät #' . $deviceId),
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
            // Counter reset / wrap: fall back to power integration
            if ($delta >= 0 && $delta < 1_000_000) {
                return $delta;
            }
        }

        // Integrate power: Wh ≈ sum(W * Δh)
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

<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Device extends Model
{
    protected $fillable = [
        'name', 'type', 'room_id', 'mqtt_topic',
        'status', 'attributes', 'last_seen', 'active',
    ];

    protected $casts = [
        'attributes' => 'array',
        'last_seen'  => 'datetime',
        'active'     => 'boolean',
    ];

    protected $appends = [
        'blocked_commands',
    ];

    public function room(): BelongsTo
    {
        return $this->belongsTo(Room::class);
    }

    public function logs(): HasMany
    {
        return $this->hasMany(DeviceLog::class);
    }

    public function isWakeOnLan(): bool
    {
        $attrs = $this->extra();

        return $this->type === 'computer'
            || (($attrs['protocol'] ?? null) === 'wake_on_lan');
    }

    public function wolMac(): ?string
    {
        $mac = $this->extra()['mac'] ?? null;

        return is_string($mac) && $mac !== '' ? $mac : null;
    }

    public function wolIp(): ?string
    {
        $ip = $this->extra()['ip'] ?? null;
        if (is_string($ip)) {
            $ip = trim($ip);
            if (filter_var($ip, FILTER_VALIDATE_IP)) {
                return $ip;
            }
        }
        $topic = is_string($this->mqtt_topic) ? trim($this->mqtt_topic) : '';
        if ($topic !== '' && filter_var($topic, FILTER_VALIDATE_IP)) {
            return $topic;
        }

        return null;
    }

    /**
     * JSON-Spalte `attributes` — nicht $this->attributes (das ist Eloquents Spalten-Bag).
     *
     * @return array<string, mixed>
     */
    public function extra(): array
    {
        $raw = $this->getAttribute('attributes');

        return is_array($raw) ? $raw : [];
    }

    /**
     * Nach einem Schaltbefehl den Zielstatus merken, damit ein verspätetes
     * MQTT-Echo (noch „an“, obwohl wir „aus“ gesendet haben) die DB nicht
     * zurückschreibt.
     */
    public function markCommandedStatus(string $status, int $seconds = 10): void
    {
        $attrs = $this->extra();
        $attrs['commanded_status'] = $status;
        $attrs['commanded_until'] = now()->utc()->addSeconds($seconds)->toIso8601String();
        $this->update(['attributes' => $attrs]);
    }

    public function shouldIgnoreReportedStatus(string $reported): bool
    {
        if (! in_array($reported, ['on', 'off'], true)) {
            return false;
        }
        $attrs = $this->extra();
        $expected = $attrs['commanded_status'] ?? null;
        $until = $attrs['commanded_until'] ?? null;
        if (! is_string($expected) || $expected === '' || ! is_string($until) || $until === '') {
            return false;
        }
        try {
            if (now()->gte(\Carbon\Carbon::parse($until))) {
                return false;
            }
        } catch (\Throwable) {
            return false;
        }

        return $reported !== $expected;
    }

    /**
     * Command-Hold löschen, sobald das Gerät den gewünschten Status bestätigt.
     *
     * @param  array<string, mixed>  $attrs
     * @return array<string, mixed>
     */
    public function attributesWithoutCommandHoldIfConfirmed(array $attrs, string $reported): array
    {
        if (($attrs['commanded_status'] ?? null) === $reported) {
            unset($attrs['commanded_status'], $attrs['commanded_until']);
        }

        return $attrs;
    }

    /**
     * @return array<string, string>
     */
    public function getBlockedCommandsAttribute(): array
    {
        return app(\App\Services\InterlockService::class)->blockedCommands($this);
    }
}

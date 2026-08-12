<?php

namespace App\Services;

use App\Models\PanelSetting;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use RuntimeException;

class SpotifyService
{
    private const AUTH_URL = 'https://accounts.spotify.com/authorize';

    private const TOKEN_URL = 'https://accounts.spotify.com/api/token';

    private const API = 'https://api.spotify.com/v1';

    private const SCOPES = [
        'user-read-playback-state',
        'user-modify-playback-state',
        'user-read-currently-playing',
        'streaming',
        'playlist-read-private',
        'user-library-read',
    ];

    public function isConfigured(): bool
    {
        return $this->clientId() !== '' && $this->clientSecret() !== '';
    }

    public function isConnected(): bool
    {
        $raw = PanelSetting::getValue('spotify');
        if (!is_array($raw)) {
            return false;
        }

        return !empty($raw['refresh_token']);
    }

    /**
     * @return array{connected: bool, display_name: string|null, has_streaming: bool}
     */
    public function publicStatus(): array
    {
        $raw = PanelSetting::getValue('spotify');
        if (!is_array($raw) || empty($raw['refresh_token'])) {
            return ['connected' => false, 'display_name' => null, 'has_streaming' => false];
        }

        $name = isset($raw['display_name']) ? trim((string) $raw['display_name']) : '';

        return [
            'connected' => true,
            'display_name' => $name !== '' ? $name : null,
            'has_streaming' => $this->hasStreamingScope($raw),
        ];
    }

    public function getAuthUrl(): string
    {
        if (!$this->isConfigured()) {
            throw new RuntimeException('Spotify ist nicht konfiguriert (CLIENT_ID/SECRET fehlen)');
        }

        $state = Str::random(40);
        Cache::put('spotify_oauth_state', $state, now()->addMinutes(10));

        $params = http_build_query([
            'client_id' => $this->clientId(),
            'response_type' => 'code',
            'redirect_uri' => $this->redirectUri(),
            'scope' => implode(' ', self::SCOPES),
            'state' => $state,
            'show_dialog' => 'true',
        ]);

        return self::AUTH_URL . '?' . $params;
    }

    public function handleCallback(string $code, string $state): void
    {
        $expected = Cache::pull('spotify_oauth_state');
        if (!is_string($expected) || !hash_equals($expected, $state)) {
            throw new RuntimeException('Ungültiger OAuth-State');
        }

        $res = Http::asForm()
            ->withBasicAuth($this->clientId(), $this->clientSecret())
            ->post(self::TOKEN_URL, [
                'grant_type' => 'authorization_code',
                'code' => $code,
                'redirect_uri' => $this->redirectUri(),
            ]);

        if (!$res->successful()) {
            throw new RuntimeException('Token-Austausch fehlgeschlagen (HTTP ' . $res->status() . ')');
        }

        $data = $res->json();
        $access = (string) ($data['access_token'] ?? '');
        $refresh = (string) ($data['refresh_token'] ?? '');
        $expiresIn = (int) ($data['expires_in'] ?? 3600);
        if ($access === '') {
            throw new RuntimeException('Kein Access-Token von Spotify');
        }

        $existing = PanelSetting::getValue('spotify');
        if (!is_array($existing)) {
            $existing = [];
        }
        if ($refresh === '' && !empty($existing['refresh_token'])) {
            $refresh = (string) $existing['refresh_token'];
        }
        if ($refresh === '') {
            throw new RuntimeException('Kein Refresh-Token von Spotify');
        }

        $displayName = null;
        try {
            $me = Http::withToken($access)->acceptJson()->get(self::API . '/me');
            if ($me->successful()) {
                $displayName = $me->json('display_name') ?: $me->json('id');
            }
        } catch (\Throwable $e) {
            /* ignore */
        }

        PanelSetting::setValue('spotify', [
            'access_token' => $access,
            'refresh_token' => $refresh,
            'expires_at' => now()->addSeconds(max(60, $expiresIn - 60))->timestamp,
            'display_name' => is_string($displayName) ? $displayName : ($existing['display_name'] ?? null),
            'scope' => (string) ($data['scope'] ?? ($existing['scope'] ?? '')),
        ]);
    }

    public function disconnect(): void
    {
        PanelSetting::setValue('spotify', null);
    }

    /**
     * @return array{access_token: string, expires_in: int}
     */
    public function getAccessTokenForClient(): array
    {
        $raw = PanelSetting::getValue('spotify');
        if (is_array($raw) && isset($raw['scope']) && trim((string) $raw['scope']) !== '' && !$this->hasStreamingScope($raw)) {
            throw new RuntimeException(
                'Token ohne streaming-Scope — Spotify in den Einstellungen trennen und neu verbinden'
            );
        }

        $token = $this->ensureAccessToken();
        $raw = PanelSetting::getValue('spotify');
        $expiresAt = is_array($raw) ? (int) ($raw['expires_at'] ?? 0) : 0;
        $expiresIn = max(60, $expiresAt - time());

        return [
            'access_token' => $token,
            'expires_in' => $expiresIn,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function nowPlaying(): array
    {
        if (!$this->isConnected()) {
            return [
                'configured' => false,
                'connected' => false,
                'active' => false,
                'error' => null,
            ];
        }

        $token = $this->ensureAccessToken();
        $res = Http::withToken($token)->acceptJson()->get(self::API . '/me/player');

        if ($res->status() === 204 || $res->body() === '') {
            return [
                'configured' => true,
                'connected' => true,
                'active' => false,
                'is_playing' => false,
                'item' => null,
                'device' => null,
                'progress_ms' => 0,
                'volume_percent' => null,
                'error' => 'Kein aktives Gerät — Spotify öffnen oder „Hier abspielen“ tippen',
            ];
        }

        if (!$res->successful()) {
            return [
                'configured' => true,
                'connected' => true,
                'active' => false,
                'error' => 'Player nicht ladbar (HTTP ' . $res->status() . ')',
            ];
        }

        $body = $res->json();
        if (!is_array($body)) {
            return [
                'configured' => true,
                'connected' => true,
                'active' => false,
                'error' => 'Ungültige Player-Antwort',
            ];
        }

        return [
            'configured' => true,
            'connected' => true,
            'active' => true,
            'is_playing' => (bool) ($body['is_playing'] ?? false),
            'progress_ms' => (int) ($body['progress_ms'] ?? 0),
            'volume_percent' => isset($body['device']['volume_percent'])
                ? (int) $body['device']['volume_percent']
                : null,
            'shuffle' => (bool) ($body['shuffle_state'] ?? false),
            'repeat' => (string) ($body['repeat_state'] ?? 'off'),
            'device' => $this->mapDevice(is_array($body['device'] ?? null) ? $body['device'] : null),
            'item' => $this->mapTrack(is_array($body['item'] ?? null) ? $body['item'] : null),
            'error' => null,
        ];
    }

    public function play(?string $uri = null, ?string $deviceId = null): void
    {
        $token = $this->ensureAccessToken();
        $query = [];
        if ($deviceId !== null && $deviceId !== '') {
            $query['device_id'] = $deviceId;
        }

        // Spotify erwartet immer ein JSON-Objekt ({} zum Fortsetzen) — nie [] oder leeren Body mit JSON-Header.
        $payload = new \stdClass();
        if ($uri !== null && $uri !== '') {
            if (strpos($uri, 'spotify:track:') === 0) {
                $payload = (object) ['uris' => [$uri]];
            } else {
                $payload = (object) ['context_uri' => $uri];
            }
        }

        $url = self::API . '/me/player/play' . ($query ? ('?' . http_build_query($query)) : '');
        $res = Http::withToken($token)
            ->withHeaders([
                'Accept' => 'application/json',
                'Content-Type' => 'application/json',
            ])
            ->withBody(json_encode($payload), 'application/json')
            ->put($url);

        if (!$res->successful() && $res->status() !== 204) {
            throw new RuntimeException($this->spotifyError($res, 'Play fehlgeschlagen'));
        }
    }

    public function pause(): void
    {
        $this->simplePlayerPut('/me/player/pause', 'Pause fehlgeschlagen');
    }

    public function next(): void
    {
        $this->simplePlayerPost('/me/player/next', 'Next fehlgeschlagen');
    }

    public function previous(): void
    {
        $this->simplePlayerPost('/me/player/previous', 'Previous fehlgeschlagen');
    }

    public function setVolume(int $volume): void
    {
        $volume = max(0, min(100, $volume));
        $token = $this->ensureAccessToken();
        $res = Http::withToken($token)
            ->acceptJson()
            ->put(self::API . '/me/player/volume?' . http_build_query(['volume_percent' => $volume]));

        if (!$res->successful() && $res->status() !== 204) {
            throw new RuntimeException($this->spotifyError($res, 'Lautstärke fehlgeschlagen'));
        }
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function listDevices(): array
    {
        $token = $this->ensureAccessToken();
        $res = Http::withToken($token)->acceptJson()->get(self::API . '/me/player/devices');
        if (!$res->successful()) {
            throw new RuntimeException($this->spotifyError($res, 'Geräte nicht ladbar'));
        }
        $devices = $res->json('devices');
        if (!is_array($devices)) {
            return [];
        }
        $out = [];
        foreach ($devices as $d) {
            if (!is_array($d)) {
                continue;
            }
            $mapped = $this->mapDevice($d);
            if ($mapped !== null) {
                $out[] = $mapped;
            }
        }

        return $out;
    }

    public function transfer(string $deviceId, bool $play = false): void
    {
        $token = $this->ensureAccessToken();
        $res = Http::withToken($token)
            ->withHeaders([
                'Accept' => 'application/json',
                'Content-Type' => 'application/json',
            ])
            ->withBody(json_encode([
                'device_ids' => [$deviceId],
                'play' => $play,
            ], JSON_THROW_ON_ERROR), 'application/json')
            ->put(self::API . '/me/player');

        if (!$res->successful() && $res->status() !== 204) {
            throw new RuntimeException($this->spotifyError($res, 'Gerätewechsel fehlgeschlagen'));
        }
    }

    /**
     * @return array{tracks: list<array<string, mixed>>, playlists: list<array<string, mixed>>}
     */
    public function search(string $query): array
    {
        $query = trim($query);
        if (mb_strlen($query) < 2) {
            return ['tracks' => [], 'playlists' => []];
        }

        $token = $this->ensureAccessToken();
        $res = Http::withToken($token)->acceptJson()->get(self::API . '/search', [
            'q' => $query,
            'type' => 'track,playlist',
            'limit' => 8,
        ]);

        if (!$res->successful()) {
            throw new RuntimeException($this->spotifyError($res, 'Suche fehlgeschlagen'));
        }

        $tracks = [];
        foreach ($res->json('tracks.items') ?? [] as $item) {
            if (!is_array($item)) {
                continue;
            }
            $mapped = $this->mapTrack($item);
            if ($mapped !== null) {
                $tracks[] = $mapped;
            }
        }

        $playlists = [];
        foreach ($res->json('playlists.items') ?? [] as $item) {
            if (!is_array($item)) {
                continue;
            }
            $id = (string) ($item['id'] ?? '');
            $uri = (string) ($item['uri'] ?? '');
            $name = (string) ($item['name'] ?? '');
            if ($id === '' || $uri === '' || $name === '') {
                continue;
            }
            $images = is_array($item['images'] ?? null) ? $item['images'] : [];
            $image = null;
            if ($images !== [] && is_array($images[0])) {
                $image = $images[0]['url'] ?? null;
            }
            $playlists[] = [
                'id' => $id,
                'uri' => $uri,
                'name' => $name,
                'owner' => (string) ($item['owner']['display_name'] ?? ''),
                'image' => is_string($image) ? $image : null,
                'tracks_total' => (int) ($item['tracks']['total'] ?? 0),
            ];
        }

        return ['tracks' => $tracks, 'playlists' => $playlists];
    }

    /**
     * @return array{currently_playing: array<string, mixed>|null, queue: list<array<string, mixed>>}
     */
    public function getQueue(): array
    {
        $token = $this->ensureAccessToken();
        $res = Http::withToken($token)->acceptJson()->get(self::API . '/me/player/queue');
        if (!$res->successful()) {
            throw new RuntimeException($this->spotifyError($res, 'Queue nicht ladbar'));
        }

        $current = is_array($res->json('currently_playing'))
            ? $this->mapTrack($res->json('currently_playing'))
            : null;
        $queue = [];
        foreach ($res->json('queue') ?? [] as $item) {
            if (!is_array($item)) {
                continue;
            }
            $mapped = $this->mapTrack($item);
            if ($mapped !== null) {
                $queue[] = $mapped;
            }
            if (count($queue) >= 20) {
                break;
            }
        }

        return [
            'currently_playing' => $current,
            'queue' => $queue,
        ];
    }

    public function addToQueue(string $uri): void
    {
        $token = $this->ensureAccessToken();
        $res = Http::withToken($token)
            ->acceptJson()
            ->post(self::API . '/me/player/queue?' . http_build_query(['uri' => $uri]));

        if (!$res->successful() && $res->status() !== 204) {
            throw new RuntimeException($this->spotifyError($res, 'Zur Queue hinzufügen fehlgeschlagen'));
        }
    }

    private function ensureAccessToken(): string
    {
        if (!$this->isConnected()) {
            throw new RuntimeException('Spotify nicht verbunden');
        }

        $raw = PanelSetting::getValue('spotify');
        if (!is_array($raw)) {
            throw new RuntimeException('Spotify nicht verbunden');
        }

        $access = (string) ($raw['access_token'] ?? '');
        $expiresAt = (int) ($raw['expires_at'] ?? 0);
        if ($access !== '' && $expiresAt > time() + 30) {
            return $access;
        }

        $refresh = (string) ($raw['refresh_token'] ?? '');
        if ($refresh === '') {
            throw new RuntimeException('Kein Refresh-Token');
        }

        $res = Http::asForm()
            ->withBasicAuth($this->clientId(), $this->clientSecret())
            ->post(self::TOKEN_URL, [
                'grant_type' => 'refresh_token',
                'refresh_token' => $refresh,
            ]);

        if (!$res->successful()) {
            throw new RuntimeException('Token-Refresh fehlgeschlagen (HTTP ' . $res->status() . ')');
        }

        $data = $res->json();
        $access = (string) ($data['access_token'] ?? '');
        $expiresIn = (int) ($data['expires_in'] ?? 3600);
        if ($access === '') {
            throw new RuntimeException('Kein Access-Token beim Refresh');
        }

        if (!empty($data['refresh_token'])) {
            $refresh = (string) $data['refresh_token'];
        }

        PanelSetting::setValue('spotify', [
            'access_token' => $access,
            'refresh_token' => $refresh,
            'expires_at' => now()->addSeconds(max(60, $expiresIn - 60))->timestamp,
            'display_name' => $raw['display_name'] ?? null,
            'scope' => (string) ($data['scope'] ?? ($raw['scope'] ?? '')),
        ]);

        return $access;
    }

    /**
     * @param  array<string, mixed>  $raw
     */
    private function hasStreamingScope(array $raw): bool
    {
        $scope = strtolower(trim((string) ($raw['scope'] ?? '')));
        if ($scope === '') {
            // Alte Verbindungen ohne gespeicherte Scopes: unbekannt → UI kann neu verbinden anbieten
            return false;
        }
        foreach (preg_split('/\s+/', $scope) ?: [] as $part) {
            if ($part === 'streaming') {
                return true;
            }
        }

        return false;
    }

    private function simplePlayerPut(string $path, string $label): void
    {
        $token = $this->ensureAccessToken();
        $res = Http::withToken($token)
            ->withHeaders([
                'Accept' => 'application/json',
                'Content-Type' => 'application/json',
            ])
            ->withBody('{}', 'application/json')
            ->put(self::API . $path);
        if (!$res->successful() && $res->status() !== 204) {
            throw new RuntimeException($this->spotifyError($res, $label));
        }
    }

    private function simplePlayerPost(string $path, string $label): void
    {
        $token = $this->ensureAccessToken();
        $res = Http::withToken($token)->acceptJson()->post(self::API . $path);
        if (!$res->successful() && $res->status() !== 204) {
            throw new RuntimeException($this->spotifyError($res, $label));
        }
    }

    /**
     * @param  array<string, mixed>|null  $d
     * @return array<string, mixed>|null
     */
    private function mapDevice(?array $d): ?array
    {
        if ($d === null) {
            return null;
        }
        $id = (string) ($d['id'] ?? '');
        if ($id === '') {
            return null;
        }

        return [
            'id' => $id,
            'name' => (string) ($d['name'] ?? 'Gerät'),
            'type' => (string) ($d['type'] ?? ''),
            'is_active' => (bool) ($d['is_active'] ?? false),
            'volume_percent' => isset($d['volume_percent']) ? (int) $d['volume_percent'] : null,
            'supports_volume' => !empty($d['supports_volume']),
        ];
    }

    /**
     * @param  array<string, mixed>|null  $t
     * @return array<string, mixed>|null
     */
    private function mapTrack(?array $t): ?array
    {
        if ($t === null) {
            return null;
        }
        $uri = (string) ($t['uri'] ?? '');
        $name = (string) ($t['name'] ?? '');
        if ($uri === '' || $name === '') {
            return null;
        }
        $artists = [];
        foreach ($t['artists'] ?? [] as $a) {
            if (is_array($a) && !empty($a['name'])) {
                $artists[] = (string) $a['name'];
            }
        }
        $images = is_array($t['album']['images'] ?? null) ? $t['album']['images'] : [];
        $image = null;
        if ($images !== [] && is_array($images[0])) {
            $image = $images[0]['url'] ?? null;
        }

        return [
            'id' => (string) ($t['id'] ?? ''),
            'uri' => $uri,
            'name' => $name,
            'artists' => $artists,
            'album' => (string) ($t['album']['name'] ?? ''),
            'image' => is_string($image) ? $image : null,
            'duration_ms' => (int) ($t['duration_ms'] ?? 0),
        ];
    }

    private function spotifyError(\Illuminate\Http\Client\Response $res, string $fallback): string
    {
        $msg = $res->json('error.message');
        if (is_string($msg) && $msg !== '') {
            return $fallback . ': ' . $msg;
        }

        return $fallback . ' (HTTP ' . $res->status() . ')';
    }

    private function clientId(): string
    {
        return trim((string) config('services.spotify.client_id', env('SPOTIFY_CLIENT_ID', '')));
    }

    private function clientSecret(): string
    {
        return trim((string) config('services.spotify.client_secret', env('SPOTIFY_CLIENT_SECRET', '')));
    }

    private function redirectUri(): string
    {
        $uri = trim((string) config('services.spotify.redirect_uri', env('SPOTIFY_REDIRECT_URI', '')));
        if ($uri !== '') {
            return $uri;
        }

        return rtrim((string) config('app.url'), '/') . '/api/v1/spotify/callback';
    }
}

<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\SpotifyService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

class SpotifyController extends Controller
{
    public function __construct(private SpotifyService $spotify) {}

    public function authUrl(): JsonResponse
    {
        try {
            return response()->json(['url' => $this->spotify->getAuthUrl()]);
        } catch (\Throwable $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }
    }

    public function callback(Request $request): RedirectResponse
    {
        $frontend = rtrim((string) env('FRONTEND_URL', config('app.frontend_url', 'http://localhost:3000')), '/');
        $fail = $frontend . '/settings?view=widgets&spotify=error';
        $ok = $frontend . '/settings?view=widgets&spotify=connected';

        $code = $request->query('code');
        $state = $request->query('state');
        $error = $request->query('error');

        if (is_string($error) && $error !== '') {
            return redirect($fail . '&reason=' . urlencode($error));
        }
        if (!is_string($code) || $code === '' || !is_string($state) || $state === '') {
            return redirect($fail . '&reason=missing_code');
        }

        try {
            $this->spotify->handleCallback($code, $state);
        } catch (\Throwable $e) {
            return redirect($fail . '&reason=' . urlencode($e->getMessage()));
        }

        return redirect($ok);
    }

    public function disconnect(): JsonResponse
    {
        $this->spotify->disconnect();

        return response()->json($this->spotify->publicStatus());
    }

    public function status(): JsonResponse
    {
        return response()->json($this->spotify->publicStatus());
    }

    public function token(): JsonResponse
    {
        try {
            return response()->json($this->spotify->getAccessTokenForClient());
        } catch (\Throwable $e) {
            return response()->json(['error' => $e->getMessage()], 401);
        }
    }

    public function player(): JsonResponse
    {
        return response()->json($this->spotify->nowPlaying());
    }

    public function play(Request $request): JsonResponse
    {
        $data = $request->validate([
            'uri' => 'sometimes|nullable|string|max:200',
            'device_id' => 'sometimes|nullable|string|max:128',
        ]);

        try {
            $this->spotify->play(
                isset($data['uri']) ? (string) $data['uri'] : null,
                isset($data['device_id']) ? (string) $data['device_id'] : null,
            );

            return response()->json(['ok' => true]);
        } catch (\Throwable $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }
    }

    public function pause(): JsonResponse
    {
        return $this->wrap(fn () => $this->spotify->pause());
    }

    public function next(): JsonResponse
    {
        return $this->wrap(fn () => $this->spotify->next());
    }

    public function previous(): JsonResponse
    {
        return $this->wrap(fn () => $this->spotify->previous());
    }

    public function volume(Request $request): JsonResponse
    {
        $data = $request->validate([
            'volume' => 'required|integer|min:0|max:100',
        ]);

        return $this->wrap(fn () => $this->spotify->setVolume((int) $data['volume']));
    }

    public function devices(): JsonResponse
    {
        try {
            return response()->json(['devices' => $this->spotify->listDevices()]);
        } catch (\Throwable $e) {
            return response()->json(['devices' => [], 'error' => $e->getMessage()], 422);
        }
    }

    public function transfer(Request $request): JsonResponse
    {
        $data = $request->validate([
            'device_id' => 'required|string|max:128',
            'play' => 'sometimes|boolean',
        ]);

        return $this->wrap(fn () => $this->spotify->transfer(
            (string) $data['device_id'],
            (bool) ($data['play'] ?? false),
        ));
    }

    public function search(Request $request): JsonResponse
    {
        $data = $request->validate([
            'q' => 'required|string|min:2|max:120',
        ]);

        try {
            return response()->json($this->spotify->search($data['q']));
        } catch (\Throwable $e) {
            return response()->json([
                'tracks' => [],
                'playlists' => [],
                'error' => $e->getMessage(),
            ], 422);
        }
    }

    public function queue(): JsonResponse
    {
        try {
            return response()->json($this->spotify->getQueue());
        } catch (\Throwable $e) {
            return response()->json([
                'currently_playing' => null,
                'queue' => [],
                'error' => $e->getMessage(),
            ], 422);
        }
    }

    public function addToQueue(Request $request): JsonResponse
    {
        $data = $request->validate([
            'uri' => 'required|string|max:200',
        ]);

        return $this->wrap(fn () => $this->spotify->addToQueue((string) $data['uri']));
    }

    private function wrap(callable $fn): JsonResponse
    {
        try {
            $fn();

            return response()->json(['ok' => true]);
        } catch (\Throwable $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }
    }
}

<?php

namespace App\Jobs;

use App\Models\Scene;
use App\Services\SceneService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

class DelayedSceneActivate implements ShouldQueue
{
    use Queueable;

    public function __construct(public readonly int $sceneId) {}

    public function handle(SceneService $sceneService): void
    {
        $scene = Scene::find($this->sceneId);
        if (! $scene) {
            return;
        }

        try {
            $sceneService->activate($scene);
        } catch (\Throwable $e) {
            Log::error("[DelayedSceneActivate] {$scene->name}: {$e->getMessage()}");
        }
    }
}

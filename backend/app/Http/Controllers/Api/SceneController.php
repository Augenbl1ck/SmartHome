<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Jobs\DelayedSceneActivate;
use App\Models\Scene;
use App\Services\SceneService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SceneController extends Controller
{
    public function __construct(private SceneService $sceneService) {}

    public function index(): JsonResponse
    {
        return response()->json(Scene::orderBy('name')->get());
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name'    => 'required|string|max:100',
            'icon'    => 'nullable|string|max:10',
            'actions' => 'required|array|min:1',
            'actions.*' => 'required|array',
            'active'  => 'boolean',
        ]);
        $data['actions'] = $this->sanitizeActions($data['actions']);
        return response()->json(Scene::create($data), 201);
    }

    public function show(Scene $scene): JsonResponse
    {
        return response()->json($scene);
    }

    public function update(Request $request, Scene $scene): JsonResponse
    {
        $data = $request->validate([
            'name'    => 'sometimes|string|max:100',
            'icon'    => 'nullable|string|max:10',
            'actions' => 'sometimes|array|min:1',
            'actions.*' => 'required_with:actions|array',
            'active'  => 'boolean',
        ]);
        if (isset($data['actions'])) {
            $data['actions'] = $this->sanitizeActions($data['actions']);
        }
        $scene->update($data);
        return response()->json($scene);
    }

    public function destroy(Scene $scene): JsonResponse
    {
        $scene->delete();
        return response()->json(null, 204);
    }

    public function activate(Request $request, Scene $scene): JsonResponse
    {
        $data = $request->validate([
            'delay_minutes' => 'sometimes|nullable|integer|min:0|max:1440',
        ]);
        $delay = (int) ($data['delay_minutes'] ?? 0);
        if ($delay > 0) {
            DelayedSceneActivate::dispatch($scene->id)->delay(now()->addMinutes($delay));

            return response()->json([
                'activated' => false,
                'scheduled' => true,
                'delay_minutes' => $delay,
                'scene' => $scene->name,
            ]);
        }

        $this->sceneService->activate($scene);

        return response()->json([
            'activated' => true,
            'scheduled' => false,
            'scene' => $scene->name,
        ]);
    }

    /**
     * @param  array<int, mixed>  $actions
     * @return array<int, array<string, mixed>>
     */
    private function sanitizeActions(array $actions): array
    {
        $out = [];
        foreach ($actions as $action) {
            if (!is_array($action)) {
                continue;
            }
            $out[] = $this->sceneService->normalizeAction($action);
        }
        return $out;
    }
}

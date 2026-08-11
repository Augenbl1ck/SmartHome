<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
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
            'name'                => 'required|string|max:100',
            'icon'                => 'nullable|string|max:10',
            'actions'             => 'required|array',
            'actions.*.device_id' => 'required|integer|exists:devices,id',
            'actions.*.status'    => 'required|string|in:on,off,toggle',
            'active'              => 'boolean',
        ]);
        return response()->json(Scene::create($data), 201);
    }

    public function show(Scene $scene): JsonResponse
    {
        return response()->json($scene);
    }

    public function update(Request $request, Scene $scene): JsonResponse
    {
        $data = $request->validate([
            'name'                => 'sometimes|string|max:100',
            'icon'                => 'nullable|string|max:10',
            'actions'             => 'sometimes|array',
            'actions.*.device_id' => 'required_with:actions|integer|exists:devices,id',
            'actions.*.status'    => 'required_with:actions|string|in:on,off,toggle',
            'active'              => 'boolean',
        ]);
        $scene->update($data);
        return response()->json($scene);
    }

    public function destroy(Scene $scene): JsonResponse
    {
        $scene->delete();
        return response()->json(null, 204);
    }

    public function activate(Scene $scene): JsonResponse
    {
        $this->sceneService->activate($scene);
        return response()->json(['activated' => true, 'scene' => $scene->name]);
    }
}

<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Automation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AutomationController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json(Automation::all());
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name'    => 'required|string|max:255',
            'trigger' => 'required|array',
            'action'  => 'required|array',
            'enabled' => 'sometimes|boolean',
        ]);

        return response()->json(Automation::create($data), 201);
    }

    public function show(Automation $automation): JsonResponse
    {
        return response()->json($automation);
    }

    public function update(Request $request, Automation $automation): JsonResponse
    {
        $data = $request->validate([
            'name'    => 'sometimes|string|max:255',
            'trigger' => 'sometimes|array',
            'action'  => 'sometimes|array',
            'enabled' => 'sometimes|boolean',
        ]);

        $automation->update($data);

        return response()->json($automation);
    }

    public function destroy(Automation $automation): JsonResponse
    {
        $automation->delete();

        return response()->json(null, 204);
    }
}

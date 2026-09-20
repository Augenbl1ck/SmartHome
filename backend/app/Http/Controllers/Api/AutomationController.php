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
            'name'       => 'required|string|max:255',
            'trigger'    => 'required|array',
            'action'     => 'required|array',
            'conditions' => 'nullable|array',
            'enabled'    => 'sometimes|boolean',
            'retry_if_blocked' => 'sometimes|boolean',
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
            'name'       => 'sometimes|string|max:255',
            'trigger'    => 'sometimes|array',
            'action'     => 'sometimes|array',
            'conditions' => 'nullable|array',
            'enabled'    => 'sometimes|boolean',
            'retry_if_blocked' => 'sometimes|boolean',
        ]);

        if ((array_key_exists('enabled', $data) && $data['enabled'] === false)
            || (array_key_exists('retry_if_blocked', $data) && $data['retry_if_blocked'] === false)
        ) {
            $data['blocked_retry_at'] = null;
            $data['blocked_retry_started_at'] = null;
        }

        $automation->update($data);

        return response()->json($automation);
    }

    public function destroy(Automation $automation): JsonResponse
    {
        $automation->delete();

        return response()->json(null, 204);
    }
}

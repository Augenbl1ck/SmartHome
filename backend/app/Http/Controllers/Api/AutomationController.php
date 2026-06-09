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

     * Display a listing of the resource.
     */
    public function index()
    {
        //
    }

    /**
     * Show the form for creating a new resource.
     */
    public function create()
    {
        //
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        //
    }

    /**
     * Display the specified resource.
     */
    public function show(string $id)
    {
        //
    }

    /**
     * Show the form for editing the specified resource.
     */
    public function edit(string $id)
    {
        //
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, string $id)
    {
        //
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(string $id)
    {
        //
    }
}

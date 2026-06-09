<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Room;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RoomController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json(Room::withCount('devices')->get());
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => 'required|string|max:255',
            'icon' => 'nullable|string|max:50',
        ]);

        return response()->json(Room::create($data), 201);
    }

    public function show(Room $room): JsonResponse
    {
        return response()->json($room->load('devices'));
    }

    public function update(Request $request, Room $room): JsonResponse
    {
        $data = $request->validate([
            'name' => 'sometimes|string|max:255',
            'icon' => 'nullable|string|max:50',
        ]);

        $room->update($data);

        return response()->json($room);
    }

    public function destroy(Room $room): JsonResponse
    {
        $room->delete();

        return response()->json(null, 204);
    }
}

    /**
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

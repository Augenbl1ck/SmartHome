<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Device;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DeviceController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = Device::with('room');

        if ($request->has('room_id')) {
            $query->where('room_id', $request->room_id);
        }

        return response()->json($query->get());
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name'       => 'required|string|max:255',
            'type'       => 'required|string',
            'room_id'    => 'required|exists:rooms,id',
            'mqtt_topic' => 'required|string|max:255',
            'attributes' => 'nullable|array',
        ]);

        return response()->json(Device::create($data), 201);
    }

    public function show(Device $device): JsonResponse
    {
        return response()->json($device->load('room'));
    }

    public function update(Request $request, Device $device): JsonResponse
    {
        $data = $request->validate([
            'name'       => 'sometimes|string|max:255',
            'type'       => 'sometimes|string',
            'room_id'    => 'sometimes|exists:rooms,id',
            'mqtt_topic' => 'sometimes|string|max:255',
            'status'     => 'sometimes|string',
            'attributes' => 'nullable|array',
            'active'     => 'sometimes|boolean',
        ]);

        $device->update($data);

        return response()->json($device->load('room'));
    }

    public function destroy(Device $device): JsonResponse
    {
        $device->delete();

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

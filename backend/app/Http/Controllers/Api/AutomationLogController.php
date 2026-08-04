<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AutomationLog;
use Illuminate\Http\JsonResponse;

class AutomationLogController extends Controller
{
    public function index(): JsonResponse
    {
        $logs = AutomationLog::orderByDesc('fired_at')
            ->limit(200)
            ->get(['id', 'automation_id', 'automation_name', 'action_summary', 'fired_at']);

        return response()->json($logs);
    }
}

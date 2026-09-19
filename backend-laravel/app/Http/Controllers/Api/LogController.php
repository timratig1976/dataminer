<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class LogController extends Controller
{
    /**
     * Get recent logs for a case.
     * GET /api/logs?caseId=...
     */
    public function index(Request $request): JsonResponse
    {
        $caseId = $request->query('caseId');
        if (!$caseId) {
            return response()->json(['error' => 'caseId required'], 400);
        }

        $limit = min(500, max(10, (int) $request->query('limit', 200)));

        // Retrieve agent run logs or system logs
        $runs = \App\Models\AgentRun::where('case_id', $caseId)->orderByDesc('created_at')->limit(5)->get();
        $logs = [];

        foreach ($runs as $r) {
            $state = $r->state ?? [];
            $runLogs = $state['logs'] ?? [];
            foreach ($runLogs as $entry) {
                $logs[] = [
                    'id' => (string) \Illuminate\Support\Str::uuid(),
                    'message' => $entry['message'] ?? (is_string($entry) ? $entry : json_encode($entry)),
                    'createdAt' => $entry['timestamp'] ?? $r->created_at->toIso8601String(),
                ];
            }
        }

        return response()->json($logs);
    }

    /**
     * Clear logs for a case.
     * DELETE /api/logs?caseId=...
     */
    public function destroy(Request $request): JsonResponse
    {
        $caseId = $request->query('caseId');
        if ($caseId) {
            $runs = \App\Models\AgentRun::where('case_id', $caseId)->get();
            foreach ($runs as $r) {
                $state = $r->state ?? [];
                $state['logs'] = [];
                $r->update(['state' => $state]);
            }
        }
        return response()->json(['ok' => true]);
    }
}

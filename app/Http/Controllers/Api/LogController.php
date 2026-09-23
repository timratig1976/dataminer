<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CaseLog;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

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

        $dbLogs = CaseLog::where('case_id', $caseId)
            ->orderBy('id', 'desc')
            ->limit($limit)
            ->get();

        $logs = [];
        foreach ($dbLogs as $l) {
            $logs[] = [
                'id' => (string) $l->id,
                'message' => $l->message,
                'createdAt' => $l->created_at ? $l->created_at->toIso8601String() : now()->toIso8601String(),
            ];
        }

        // Also merge agent run logs if present
        $runs = \App\Models\AgentRun::where('case_id', $caseId)->orderByDesc('created_at')->limit(3)->get();
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
        if (!$caseId) {
            return response()->json(['error' => 'caseId required'], 400);
        }

        CaseLog::where('case_id', $caseId)->delete();

        $runs = \App\Models\AgentRun::where('case_id', $caseId)->get();
        foreach ($runs as $r) {
            $state = $r->state ?? [];
            $state['logs'] = [];
            $r->update(['state' => $state]);
        }

        return response()->json(['success' => true]);
    }
}

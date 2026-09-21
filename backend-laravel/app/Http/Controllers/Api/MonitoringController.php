<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AgentRun;
use App\Models\DataCase;
use App\Models\Row;
use Illuminate\Http\JsonResponse;

class MonitoringController extends Controller
{
    /**
     * Get global monitoring metrics across all cases.
     * GET /api/monitoring/overview
     */
    public function overview(): JsonResponse
    {
        $runs = AgentRun::orderByDesc('updated_at')->get();
        $cases = DataCase::withCount('rows')->get()->keyBy('id');

        $activeRuns = [];
        $totalCostUsd = 0;
        $totalTokens = 0;
        $totalRowsDiscovered = 0;
        $completedRuns = 0;
        $runningRuns = 0;

        foreach ($runs as $r) {
            $state = $r->state ?? [];
            $cost = (float) ($state['costUsd'] ?? 0);
            $tokens = (int) ($state['tokens'] ?? 0);
            $added = (int) ($state['rows_added'] ?? 0);

            $totalCostUsd += $cost;
            $totalTokens += $tokens;
            $totalRowsDiscovered += $added;

            if ($r->status === 'running') {
                $runningRuns++;
            } elseif ($r->status === 'completed') {
                $completedRuns++;
            }

            $case = $cases[$r->case_id] ?? null;
            $goal = is_array($r->goal) ? ($r->goal['description'] ?? json_encode($r->goal)) : (string) $r->goal;
            $targetCount = is_array($r->goal) ? ($r->goal['targetCount'] ?? 3000) : 3000;
            $currentStep = $state['current_step_index'] ?? 0;
            $totalSteps = $state['total_steps'] ?? count($state['plan']['steps'] ?? []);
            $logs = $state['logs'] ?? [];
            $lastLog = count($logs) > 0 ? end($logs)['message'] : null;

            $activeRuns[] = [
                'id' => $r->id,
                'case_id' => $r->case_id,
                'case_name' => $case ? $case->name : 'Unbekannter Case',
                'goal' => $goal,
                'target_count' => $targetCount,
                'status' => $r->status,
                'current_step' => $currentStep,
                'total_steps' => $totalSteps,
                'rows_added' => $added,
                'cost_usd' => $cost,
                'tokens' => $tokens,
                'last_log' => $lastLog,
                'started_at' => $r->created_at ? $r->created_at->toIso8601String() : null,
                'updated_at' => $r->updated_at ? $r->updated_at->toIso8601String() : null,
            ];
        }

        return response()->json([
            'metrics' => [
                'total_cases' => $cases->count(),
                'total_runs' => $runs->count(),
                'running_runs' => $runningRuns,
                'completed_runs' => $completedRuns,
                'total_rows_discovered' => $totalRowsDiscovered,
                'total_cost_usd' => round($totalCostUsd, 4),
                'total_tokens' => $totalTokens,
            ],
            'runs' => $activeRuns,
        ]);
    }
}

<?php

namespace App\Services;

use App\Models\AgentRun;
use Illuminate\Support\Str;

class AgentRunnerService
{
    protected PlannerService $planner;
    protected DiscoveryService $discovery;

    public function __construct(PlannerService $planner, DiscoveryService $discovery)
    {
        $this->planner = $planner;
        $this->discovery = $discovery;
    }

    /**
     * Initializes a new goal-based Agent Run and generates its discovery plan.
     */
    public function startRun(string $caseId, string $goal, int $targetCount = 3000, string $sourceMode = 'gmb_first'): AgentRun
    {
        $plan = $this->planner->createPlan($goal, $targetCount, sourceMode: $sourceMode);

        // Ensure steps have unique string ids
        $steps = array_map(function ($s, $idx) {
            if (empty($s['id'])) {
                $s['id'] = 'step_' . ($idx + 1);
            }
            return $s;
        }, $plan['steps'] ?? [], array_keys($plan['steps'] ?? []));
        $plan['steps'] = $steps;

        $goalObj = [
            'description' => $goal,
            'targetCount' => $targetCount,
            'sourceMode' => $sourceMode,
        ];

        return AgentRun::create([
            'id' => (string) Str::uuid(),
            'case_id' => $caseId,
            'goal' => $goalObj,
            'status' => 'pending',
            'state' => [
                'id' => null, // will be populated
                'caseId' => $caseId,
                'goal' => $goalObj,
                'status' => 'pending',
                'iteration' => 0,
                'plan' => $plan,
                'stepResults' => [],
                'uniqueCount' => 0,
                'costUsd' => 0,
                'startedAt' => now()->toIso8601String(),
                'updatedAt' => now()->toIso8601String(),
                'current_step_index' => 0,
                'total_steps' => count($steps),
                'rows_added' => 0,
                'logs' => [
                    ['timestamp' => now()->toIso8601String(), 'message' => "Plan created with " . count($steps) . " steps."]
                ]
            ]
        ]);
    }

    /**
     * Executes the next pending step of an agent run.
     */
    public function executeNextStep(AgentRun $run): array
    {
        $state = $run->state ?? [];
        $plan = $state['plan'] ?? [];
        $steps = $plan['steps'] ?? [];
        $index = $state['current_step_index'] ?? 0;

        if ($index >= count($steps)) {
            $run->update(['status' => 'completed']);
            return ['completed' => true, 'run' => $run];
        }

        $step = $steps[$index];
        $run->update(['status' => 'running']);

        $addedCount = 0;
        $logMessage = '';
        $stepCost = 0.001; // default 0.001 per serper call

        try {
            if (($step['type'] ?? '') === 'google_search') {
                $query = $step['query'] ?? $step['label'];
                // Fetch maximum yield (up to 100 results)
                $limit = max(100, $step['estimated_hits'] ?? 100);
                $res = $this->discovery->discoverWeb($run->case_id, $query, $limit);
                $addedCount = $res['added_count'] ?? 0;
                $stepCost = 0.001;
                $logMessage = "Search '{$query}' found {$addedCount} new companies.";
            } elseif (($step['type'] ?? '') === 'google_maps') {
                $query = $step['map_query'] ?? $step['label'];
                $loc = $step['location'] ?? null;
                // Fetch maximum yield from Google Maps (up to 100 places per search)
                $limit = max(100, $step['estimated_hits'] ?? 100);
                $res = $this->discovery->discoverMaps($run->case_id, $query, $loc, $limit);
                $addedCount = $res['added_count'] ?? 0;
                $stepCost = 0.001;
                $logMessage = "Maps '{$query}' ({$loc}) found {$addedCount} new places.";
            }
        } catch (\Throwable $e) {
            // Check for API quota/credits exhaustion
            if (str_contains(strtolower($e->getMessage()), 'credits aufgebraucht') || str_contains(strtolower($e->getMessage()), 'not enough credits')) {
                $status = 'cancelled';
                $state['status'] = $status;
                $state['error'] = $e->getMessage();
                $state['logs'][] = [
                    'timestamp' => now()->toIso8601String(),
                    'message' => "🚨 ABBRUCH: " . $e->getMessage(),
                ];
                $run->update([
                    'status' => $status,
                    'state' => $state,
                ]);

                \App\Models\CaseLog::record($run->case_id, "🚨 Suche gestoppt: " . $e->getMessage());

                return array_merge($run->toArray(), $state, [
                    'id' => $run->id,
                    'caseId' => $run->case_id,
                    'status' => 'cancelled',
                    'error' => $e->getMessage(),
                    'completed' => true,
                ]);
            }
            throw $e;
        }

        // Record step result
        $state['stepResults'] = $state['stepResults'] ?? [];
        $state['stepResults'][] = [
            'stepId' => $step['id'] ?? ('step_' . ($index + 1)),
            'attemptedAt' => now()->toIso8601String(),
            'hitsFound' => $addedCount,
            'uniqueInserted' => $addedCount,
            'costUsd' => $stepCost,
            'source' => $step['type'] ?? 'unknown',
        ];

        // Advance state
        $state['current_step_index'] = $index + 1;
        $state['rows_added'] = ($state['rows_added'] ?? 0) + $addedCount;
        $state['uniqueCount'] = ($state['uniqueCount'] ?? 0) + $addedCount;
        $state['costUsd'] = round(($state['costUsd'] ?? 0) + $stepCost, 4);
        $state['tokens'] = ($state['tokens'] ?? 0) + 120;
        $state['updatedAt'] = now()->toIso8601String();
        $state['logs'][] = [
            'timestamp' => now()->toIso8601String(),
            'message' => $logMessage,
        ];

        $isCompleted = ($index + 1) >= count($steps);
        $status = $isCompleted ? 'completed' : 'running';
        $state['status'] = $status;
        $run->update([
            'status' => $status,
            'state' => $state,
        ]);

        return array_merge($run->toArray(), $state, [
            'id' => $run->id,
            'caseId' => $run->case_id,
            'goal' => $run->goal,
            'status' => $status,
            'completed' => $isCompleted,
            'step' => $step,
            'added' => $addedCount,
            'run' => $run,
        ]);
    }
}

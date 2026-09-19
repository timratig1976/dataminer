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
    public function startRun(string $caseId, string $goal): AgentRun
    {
        $plan = $this->planner->createPlan($goal);

        return AgentRun::create([
            'id' => (string) Str::uuid(),
            'case_id' => $caseId,
            'goal' => $goal,
            'status' => 'pending',
            'state' => [
                'plan' => $plan,
                'current_step_index' => 0,
                'total_steps' => count($plan['steps'] ?? []),
                'rows_added' => 0,
                'logs' => [
                    ['timestamp' => now()->toIso8601String(), 'message' => "Plan created with " . count($plan['steps'] ?? []) . " steps."]
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

        if (($step['type'] ?? '') === 'google_search') {
            $query = $step['query'] ?? $step['label'];
            $res = $this->discovery->discoverWeb($run->case_id, $query, $step['estimated_hits'] ?? 20);
            $addedCount = $res['added_count'] ?? 0;
            $logMessage = "Search '{$query}' found {$addedCount} new companies.";
        } elseif (($step['type'] ?? '') === 'google_maps') {
            $query = $step['map_query'] ?? $step['label'];
            $loc = $step['location'] ?? null;
            $res = $this->discovery->discoverMaps($run->case_id, $query, $loc, $step['estimated_hits'] ?? 20);
            $addedCount = $res['added_count'] ?? 0;
            $logMessage = "Maps '{$query}' ({$loc}) found {$addedCount} new places.";
        }

        // Advance state
        $state['current_step_index'] = $index + 1;
        $state['rows_added'] = ($state['rows_added'] ?? 0) + $addedCount;
        $state['logs'][] = [
            'timestamp' => now()->toIso8601String(),
            'message' => $logMessage,
        ];

        $isCompleted = ($index + 1) >= count($steps);
        $run->update([
            'status' => $isCompleted ? 'completed' : 'running',
            'state' => $state,
        ]);

        return [
            'completed' => $isCompleted,
            'step' => $step,
            'added' => $addedCount,
            'run' => $run,
        ];
    }
}

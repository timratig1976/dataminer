<?php

namespace App\Jobs;

use App\Models\AgentRun;
use App\Services\AgentRunnerService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class ProcessAgentDiscoveryRun implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 3600; // 60 minutes max per job
    public int $tries = 1;

    public function __construct(
        public string $runId
    ) {}

    public function handle(AgentRunnerService $runner): void
    {
        $run = AgentRun::find($this->runId);
        if (!$run) {
            Log::warning("[ProcessAgentDiscoveryRun] Run {$this->runId} not found.");
            return;
        }

        if (in_array($run->status, ['completed', 'cancelled', 'failed'])) {
            return;
        }

        $run->update(['status' => 'running']);

        while (true) {
            // Re-fetch to check if cancelled by user
            $run->refresh();
            if ($run->status === 'cancelled') {
                Log::info("[ProcessAgentDiscoveryRun] Run {$this->runId} cancelled by user.");
                break;
            }

            $state = $run->state ?? [];
            $plan = $state['plan'] ?? [];
            $steps = $plan['steps'] ?? [];
            $currentIndex = $state['current_step_index'] ?? 0;

            if ($currentIndex >= count($steps)) {
                $run->update(['status' => 'completed']);
                Log::info("[ProcessAgentDiscoveryRun] Run {$this->runId} completed all " . count($steps) . " steps.");
                break;
            }

            $result = $runner->executeNextStep($run);

            // If the runner caught an error or stopped (e.g. quota exhausted or completed)
            if ($result['completed'] ?? false) {
                break;
            }

            $run->refresh();
            if (in_array($run->status, ['completed', 'cancelled', 'failed'])) {
                break;
            }

            // Yield slightly to prevent rate limit bursts
            usleep(500000); // 500ms between steps
        }
    }
}

<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AgentRun;
use App\Services\AgentRunnerService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

class AgentRunController extends Controller
{
    protected AgentRunnerService $agentRunner;

    public function __construct(AgentRunnerService $agentRunner)
    {
        $this->agentRunner = $agentRunner;
    }

    /**
     * List all agent runs for a case.
     * GET /api/cases/{id}/agent
     */
    public function indexForCase(string $id): JsonResponse
    {
        $runs = AgentRun::where('case_id', $id)->orderByDesc('created_at')->get();
        return response()->json($runs);
    }

    /**
     * Start a new agent discovery run.
     * POST /api/agent/runs OR POST /api/cases/{id}/agent
     */
    public function store(Request $request, ?string $id = null): JsonResponse
    {
        $caseId = $id ?: $request->input('case_id');
        $rawGoal = $request->input('goal');

        // Support string or Next.js AgentGoal object: { description, targetCount, region, ... }
        $description = is_array($rawGoal) ? ($rawGoal['description'] ?? '') : (string) $rawGoal;

        if (empty(trim($description))) {
            return response()->json(['error' => 'goal / description required'], 400);
        }

        $run = $this->agentRunner->startRun($caseId, $description);

        return response()->json([
            'message' => 'Agent run created',
            'run' => $run,
            ...$run->toArray(),
        ], 201);
    }

    /**
     * Execute the next step in an existing agent run.
     * POST /api/agent/runs/{id}/step OR POST /api/cases/{caseId}/agent/{runId}/step
     */
    public function executeStep(string $id, ?string $runId = null): JsonResponse
    {
        $targetId = $runId ?: $id;
        $run = AgentRun::findOrFail($targetId);
        $result = $this->agentRunner->executeNextStep($run);

        return response()->json($result);
    }

    /**
     * Stream status of an agent run via Server-Sent Events (SSE).
     * GET /api/agent/runs/{id}/stream
     */
    public function stream(string $id): StreamedResponse
    {
        return response()->stream(function () use ($id) {
            $maxTicks = 60; // 60 seconds stream lifetime
            $tick = 0;

            while ($tick < $maxTicks) {
                if (connection_aborted()) break;

                $run = AgentRun::find($id);
                if (!$run) {
                    echo "event: error\ndata: " . json_encode(['error' => 'Run not found']) . "\n\n";
                    ob_flush();
                    flush();
                    break;
                }

                echo "event: state\ndata: " . json_encode([
                    'id' => $run->id,
                    'status' => $run->status,
                    'state' => $run->state,
                ]) . "\n\n";

                ob_flush();
                flush();

                if (in_array($run->status, ['completed', 'failed', 'cancelled'])) {
                    break;
                }

                sleep(1);
                $tick++;
            }
        }, 200, [
            'Content-Type' => 'text/event-stream',
            'Cache-Control' => 'no-cache',
            'X-Accel-Buffering' => 'no',
        ]);
    }

    /**
     * Get single agent run state.
     * GET /api/cases/{id}/agent/{runId}
     */
    public function show(string $caseId, string $runId): JsonResponse
    {
        $run = AgentRun::where('case_id', $caseId)->where('id', $runId)->first();
        if (!$run) {
            $run = AgentRun::find($runId);
        }
        if (!$run) {
            return response()->json(['error' => 'Run not found'], 404);
        }
        return response()->json($run);
    }

    /**
     * Cancel an agent run.
     * POST /api/cases/{id}/agent/{runId}/cancel OR PUT /api/cases/{id}/agent/{runId}
     */
    public function cancel(string $caseId, string $runId): JsonResponse
    {
        $run = AgentRun::where('case_id', $caseId)->where('id', $runId)->first();
        if (!$run) {
            $run = AgentRun::find($runId);
        }
        if (!$run) {
            return response()->json(['error' => 'Run not found'], 404);
        }

        $run->update(['status' => 'cancelled']);
        return response()->json($run);
    }

    /**
     * Resume an agent run.
     * PATCH /api/cases/{id}/agent/{runId}
     */
    public function resume(Request $request, string $caseId, string $runId): JsonResponse
    {
        $run = AgentRun::where('case_id', $caseId)->where('id', $runId)->first();
        if (!$run) {
            $run = AgentRun::find($runId);
        }
        if (!$run) {
            return response()->json(['error' => 'Run not found'], 404);
        }

        $extraSteps = $request->input('extraSteps');
        $state = $run->state ?? [];
        if (!empty($extraSteps)) {
            $plan = $state['plan'] ?? [];
            $steps = $plan['steps'] ?? [];
            $plan['steps'] = array_merge($steps, $extraSteps);
            $state['plan'] = $plan;
        }

        $run->update([
            'status' => 'pending',
            'state' => $state,
        ]);

        return response()->json($run);
    }
}

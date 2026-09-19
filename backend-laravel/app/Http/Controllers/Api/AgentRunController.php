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
     * Start a new agent discovery run.
     * POST /api/agent/runs
     */
    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'case_id' => 'required|uuid|exists:cases,id',
            'goal' => 'required|string|max:1000',
        ]);

        $run = $this->agentRunner->startRun(
            $request->input('case_id'),
            $request->input('goal')
        );

        return response()->json([
            'message' => 'Agent run created',
            'run' => $run,
        ], 201);
    }

    /**
     * Execute the next step in an existing agent run.
     * POST /api/agent/runs/{id}/step
     */
    public function executeStep(string $id): JsonResponse
    {
        $run = AgentRun::findOrFail($id);
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
}

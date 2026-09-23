<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\BatchEvaluationRun;
use App\Models\GlobalSetting;
use App\Models\ImportBatch;
use App\Services\EvaluationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class EvaluationController extends Controller
{
    public function __construct(
        protected EvaluationService $evalService
    ) {}

    /**
     * Start a sample evaluation on a batch.
     */
    public function run(Request $request, string $batchId): JsonResponse
    {
        $batch = ImportBatch::findOrFail($batchId);
        $samplePercent = (int) $request->input('sample_percent', 10);
        $samplePercent = max(1, min(100, $samplePercent));
        $promptId = $request->input('prompt_id');

        $settings = GlobalSetting::instance();
        $apiKey = $settings->eden_api_key;
        $region = $settings->eden_region ?? 'us';

        $run = $this->evalService->runSampleEvaluation(
            $batch,
            $samplePercent,
            $promptId,
            $apiKey,
            $region
        );

        return response()->json([
            'message' => "Evaluation ({$samplePercent}%) abgeschlossen.",
            'run' => $run->load('prompt:id,name,version'),
        ]);
    }

    /**
     * List all evaluation runs for a batch.
     */
    public function index(string $batchId): JsonResponse
    {
        $runs = BatchEvaluationRun::where('import_batch_id', $batchId)
            ->with('prompt:id,name,version,model')
            ->orderBy('created_at', 'desc')
            ->get();

        return response()->json($runs);
    }

    /**
     * Get detail of a specific evaluation run including hallucination flags.
     */
    public function show(string $runId): JsonResponse
    {
        $run = BatchEvaluationRun::with(['prompt', 'batch'])->findOrFail($runId);

        return response()->json($run);
    }
}

<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DataCase;
use App\Models\EnrichmentJob;
use App\Jobs\ProcessEnrichmentChunk;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class ColumnRunController extends Controller
{
    /**
     * Run an entire column via background queues.
     * POST /api/run/column
     */
    public function run(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'caseId' => 'required|string',
            'columnId' => 'required|string',
            'runMode' => 'nullable|string|in:all_force,empty_only',
        ]);

        $case = DataCase::findOrFail($validated['caseId']);

        // Find target column
        $aiCols = $case->ai_columns ?? [];
        $column = null;
        foreach ($aiCols as $c) {
            if (($c['id'] ?? '') === $validated['columnId'] || ($c['outputKey'] ?? '') === $validated['columnId']) {
                $column = $c;
                break;
            }
        }

        if (!$column) {
            return response()->json(['error' => 'Column not found'], 404);
        }

        $jobId = (string) Str::uuid();
        $totalRows = \App\Models\Row::where('case_id', $case->id)->count();

        $job = EnrichmentJob::create([
            'id' => $jobId,
            'case_id' => $case->id,
            'column_id' => $column['id'] ?? $validated['columnId'],
            'tool' => $column['tool'] ?? 'batch_company',
            'status' => 'running',
            'total_rows' => $totalRows,
            'processed_rows' => 0,
            'failed_rows' => 0,
            'config' => [
                'run_mode' => $validated['runMode'] ?? 'empty_only',
                'chunk_size' => 50,
            ],
        ]);

        // Dispatch initial queue chunk
        ProcessEnrichmentChunk::dispatch($job->id);

        return response()->json([
            'success' => true,
            'jobId' => $job->id,
            'totalRows' => $totalRows,
            'message' => 'Spalten-Ausführung an die Worker-Queue übergeben.',
        ]);
    }
}

<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\EnrichmentJob;
use App\Models\Row;
use App\Models\DataCase;
use App\Jobs\ProcessEnrichmentChunk;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class EnrichmentJobController extends Controller
{
    /**
     * POST /api/enrichment/dispatch
     * Dispatches a large scale enrichment job (supports 100k+ rows)
     */
    public function dispatchJob(Request $request)
    {
        $validated = $request->validate([
            'case_id' => 'required|string',
            'column_id' => 'required|string',
            'run_mode' => 'nullable|in:all_force,empty_only',
            'chunk_size' => 'nullable|integer|min:10|max:100',
        ]);

        $case = DataCase::find($validated['case_id']);
        if (!$case) {
            return response()->json(['error' => 'Case not found'], 404);
        }

        $columnId = $validated['column_id'];
        $column = null;
        foreach ($case->ai_columns ?? [] as $c) {
            if (($c['id'] ?? '') === $columnId || ($c['outputKey'] ?? '') === $columnId) {
                $column = $c;
                break;
            }
        }
        if (!$column) {
            return response()->json(['error' => 'Column not found in case'], 404);
        }

        $outputKey = $column['outputKey'] ?? $columnId;
        $runMode = $validated['run_mode'] ?? 'empty_only';
        $chunkSize = $validated['chunk_size'] ?? 25;

        // Query target rows: in empty_only only touch empty ones!
        $query = Row::where('case_id', $case->id);
        if ($runMode === 'empty_only') {
            $query->where(function ($q) use ($outputKey) {
                $q->whereNull("data->{$outputKey}")
                  ->orWhere("data->{$outputKey}", '')
                  ->orWhereRaw("data->>? ILIKE 'notfound'", [$outputKey]);
            });
        }

        $targetIds = $query->orderBy('row_index', 'asc')->pluck('id')->toArray();
        if (empty($targetIds)) {
            return response()->json([
                'message' => 'No empty rows found to enrich',
                'dispatched' => 0,
            ]);
        }

        // Create persistent Job record
        $jobId = (string) Str::uuid();
        $enrichmentJob = EnrichmentJob::create([
            'id' => $jobId,
            'case_id' => $case->id,
            'column_id' => $columnId,
            'tool' => $column['tool'] ?? 'batch_company',
            'status' => 'running',
            'total_rows' => count($targetIds),
            'processed_rows' => 0,
            'failed_rows' => 0,
            'config' => [
                'run_mode' => $runMode,
                'chunk_size' => $chunkSize,
            ],
        ]);

        // Dispatch chunks to queue
        $chunks = array_chunk($targetIds, $chunkSize);
        foreach ($chunks as $chunk) {
            ProcessEnrichmentChunk::dispatch($jobId, $chunk);
        }

        return response()->json([
            'job_id' => $jobId,
            'total_rows' => count($targetIds),
            'total_chunks' => count($chunks),
            'chunk_size' => $chunkSize,
            'status' => 'running',
        ], 202);
    }

    /**
     * GET /api/enrichment/jobs/{id}
     * Returns progress of an active background job
     */
    public function show(string $id)
    {
        $job = EnrichmentJob::find($id);
        if (!$job) {
            return response()->json(['error' => 'Job not found'], 404);
        }

        $percent = $job->total_rows > 0
            ? round((($job->processed_rows + $job->failed_rows) / $job->total_rows) * 100, 1)
            : 0;

        return response()->json([
            'id' => $job->id,
            'status' => $job->status,
            'total_rows' => $job->total_rows,
            'processed_rows' => $job->processed_rows,
            'failed_rows' => $job->failed_rows,
            'progress_percent' => $percent,
            'error' => $job->error,
            'created_at' => $job->created_at,
            'updated_at' => $job->updated_at,
        ]);
    }

    /**
     * POST /api/enrichment/jobs/{id}/cancel
     */
    public function cancel(string $id)
    {
        $job = EnrichmentJob::find($id);
        if (!$job) {
            return response()->json(['error' => 'Job not found'], 404);
        }

        $job->update(['status' => 'cancelled']);
        return response()->json(['ok' => true, 'status' => 'cancelled']);
    }
}

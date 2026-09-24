<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Jobs\ProcessEnrichmentChunk;
use App\Models\DataCase;
use App\Models\EnrichmentJob;
use App\Models\Row;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class TableRunController extends Controller
{
    /**
     * Run all incomplete rows across all AI columns in the case.
     * POST /api/run/table
     */
    public function run(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'caseId' => 'required|string',
            'runMode' => 'nullable|string|in:empty_only,all_force',
        ]);

        $case = DataCase::findOrFail($validated['caseId']);
        $aiCols = $case->ai_columns ?? [];

        if (empty($aiCols)) {
            return response()->json(['error' => 'Keine KI-Spalten im Case vorhanden'], 400);
        }

        $runMode = $validated['runMode'] ?? 'empty_only';

        // Filter columns by autoRun flag (exclude columns where autoRun is explicitly false)
        $runnableCols = collect($aiCols)->filter(function ($col) {
            return ($col['autoRun'] ?? true) !== false;
        });

        if ($runnableCols->isEmpty()) {
            return response()->json(['error' => 'Keine KI-Spalten für automatischen Durchlauf aktiv'], 400);
        }

        // Sort columns: company enrichment first, then contact search, then rest
        $sortedCols = $runnableCols->sort(function ($a, $b) {
            $aGroup = ($a['tool'] ?? '') === 'batch_company' || ($a['columnGroup'] ?? '') === 'company' ? 0 :
                     (($a['tool'] ?? '') === 'batch_contact' || ($a['columnGroup'] ?? '') === 'contact' ? 1 : 2);
            $bGroup = ($b['tool'] ?? '') === 'batch_company' || ($b['columnGroup'] ?? '') === 'company' ? 0 :
                     (($b['tool'] ?? '') === 'batch_contact' || ($b['columnGroup'] ?? '') === 'contact' ? 1 : 2);
            return $aGroup <=> $bGroup;
        })->values();

        $dispatchedJobs = [];
        $totalTargetsCount = 0;

        foreach ($sortedCols as $col) {
            $outputKey = $col['outputKey'] ?? ($col['id'] ?? '');
            if (!$outputKey) continue;

            $query = Row::where('case_id', $case->id);

            if ($runMode === 'empty_only') {
                $query->where(function ($q) use ($outputKey) {
                    $q->whereNull("cell_statuses->{$outputKey}")
                      ->orWhere("cell_statuses->{$outputKey}", 'idle')
                      ->orWhere("cell_statuses->{$outputKey}", 'error');
                });
            }

            $count = $query->count();
            if ($count === 0) continue;

            $totalTargetsCount = max($totalTargetsCount, $count);

            $jobId = (string) Str::uuid();
            $job = EnrichmentJob::create([
                'id' => $jobId,
                'case_id' => $case->id,
                'column_id' => $col['id'] ?? $outputKey,
                'tool' => $col['tool'] ?? 'batch_company',
                'status' => 'running',
                'total_rows' => $count,
                'processed_rows' => 0,
                'failed_rows' => 0,
                'config' => [
                    'run_mode' => $runMode,
                    'chunk_size' => 50,
                ],
            ]);

            ProcessEnrichmentChunk::dispatch($job->id);

            $dispatchedJobs[] = [
                'column' => $col['name'] ?? $outputKey,
                'jobId' => $job->id,
                'targets' => $count,
            ];
        }

        if (empty($dispatchedJobs)) {
            return response()->json([
                'success' => true,
                'message' => 'Alle Zeilen sind bereits fertig!',
                'dispatched' => 0,
            ]);
        }

        return response()->json([
            'success' => true,
            'message' => "Tabelle gestartet: {$totalTargetsCount} noch offene Zeilen an Worker übergeben.",
            'jobs' => $dispatchedJobs,
        ]);
    }
}

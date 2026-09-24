<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Jobs\ProcessRelevanceClassificationJob;
use App\Models\BlacklistDomain;
use App\Models\DataCase;
use App\Models\GlobalSetting;
use App\Models\Row;
use App\Services\RelevanceClassificationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RelevanceController extends Controller
{
    /**
     * Get relevance status, progress, stats, and cost estimate.
     * GET /api/cases/{id}/relevance-stats
     */
    public function stats(Request $request, string $id, RelevanceClassificationService $service): JsonResponse
    {
        $case = DataCase::findOrFail($id);

        $totalRows = Row::where('case_id', $case->id)->count();
        $unclassifiedRows = Row::where('case_id', $case->id)
            ->where(function ($q) {
                $q->whereNull("data->relevance_type")
                  ->orWhere("data->relevance_type", "");
            })
            ->count();

        $atypicCount = Row::where('case_id', $case->id)
            ->whereNotNull('data->relevance_type')
            ->where('data->relevance_type', '!=', 'target')
            ->count();

        $targetCount = Row::where('case_id', $case->id)
            ->where('data->relevance_type', 'target')
            ->count();

        $costEstimate = $service->estimateCost($unclassifiedRows);

        return response()->json([
            'case_id' => $case->id,
            'status' => $case->relevance_status ?? 'idle',
            'prompt' => $case->relevance_prompt ?? '',
            'total_rows' => $totalRows,
            'unclassified_rows' => $unclassifiedRows,
            'classified_rows' => $totalRows - $unclassifiedRows,
            'target_count' => $targetCount,
            'atypic_count' => $atypicCount,
            'progress' => [
                'total' => $case->relevance_total ?? 0,
                'processed' => $case->relevance_processed ?? 0,
                'percentage' => ($case->relevance_total > 0) 
                    ? round(($case->relevance_processed / $case->relevance_total) * 100, 1) 
                    : 0,
            ],
            'cost_estimate' => $costEstimate,
        ]);
    }

    /**
     * Update the relevance prompt for the case.
     * PUT /api/cases/{id}/relevance-prompt
     */
    public function updatePrompt(Request $request, string $id): JsonResponse
    {
        $validated = $request->validate([
            'prompt' => 'nullable|string|max:5000',
        ]);

        $case = DataCase::findOrFail($id);
        $case->update([
            'relevance_prompt' => $validated['prompt'] ?? null,
        ]);

        return response()->json([
            'success' => true,
            'prompt' => $case->relevance_prompt,
        ]);
    }

    /**
     * Trigger bulk classification in background job.
     * POST /api/cases/{id}/classify-bulk
     */
    public function classifyBulk(Request $request, string $id): JsonResponse
    {
        $validated = $request->validate([
            'prompt' => 'nullable|string',
            'reclassifyAll' => 'nullable|boolean',
            'maxRows' => 'nullable|integer|min:1',
        ]);

        $case = DataCase::findOrFail($id);

        if ($request->has('prompt')) {
            $case->update(['relevance_prompt' => $validated['prompt']]);
        }

        $reclassifyAll = (bool)($validated['reclassifyAll'] ?? false);
        $maxRows = $validated['maxRows'] ?? null;

        $case->update([
            'relevance_status' => 'running',
            'relevance_processed' => 0,
        ]);

        // Dispatch background job
        ProcessRelevanceClassificationJob::dispatch(
            caseId: $case->id,
            customPrompt: $case->relevance_prompt,
            reclassifyAll: $reclassifyAll,
            maxRows: $maxRows
        );

        return response()->json([
            'success' => true,
            'message' => 'Hintergrund-Prüfung gestartet.',
            'status' => 'running',
        ]);
    }

    /**
     * Cancel running background classification.
     * POST /api/cases/{id}/classify-cancel
     */
    public function cancel(string $id): JsonResponse
    {
        $case = DataCase::findOrFail($id);
        $case->update(['relevance_status' => 'idle']);

        return response()->json([
            'success' => true,
            'status' => 'idle',
            'message' => 'Prüfung abgebrochen.',
        ]);
    }

    /**
     * Get ALL atypical rows for the entire case (for project-wide review modal).
     * GET /api/cases/{id}/atypic-rows
     */
    public function atypicRows(Request $request, string $id): JsonResponse
    {
        $case = DataCase::findOrFail($id);
        $type = $request->query('type'); // optional filter: association, catalog, irrelevant

        $query = Row::where('case_id', $case->id)
            ->whereNotNull('data->relevance_type')
            ->where('data->relevance_type', '!=', 'target');

        if ($type && in_array($type, ['association', 'catalog', 'irrelevant'])) {
            $query->where('data->relevance_type', $type);
        }

        $rows = $query->orderBy('row_index', 'asc')->get();

        $mapped = $rows->map(function ($r) {
            $d = $r->data ?? [];
            return [
                'id' => $r->id,
                'name' => $d['company_name'] ?? $d['Unternehmen'] ?? 'Unbekannt',
                'domain' => $d['domain'] ?? '',
                'address' => $d['address'] ?? $d['Adresse'] ?? $d['city'] ?? $d['Stadt'] ?? '—',
                'industry' => $d['industry'] ?? $d['category'] ?? $d['Kategorie'] ?? '',
                'relevance_type' => $d['relevance_type'] ?? '',
                'relevance_reason' => $d['relevance_reason'] ?? '',
            ];
        });

        return response()->json([
            'case_id' => $case->id,
            'total' => $mapped->count(),
            'rows' => $mapped,
        ]);
    }

    /**
     * Trigger AI classification on case rows.
     * POST /api/cases/{id}/classify-relevance
     */
    public function classify(Request $request, string $id, RelevanceClassificationService $service): JsonResponse
    {
        $rowIds = $request->input('rowIds');
        $result = $service->classifyCaseRows($id, is_array($rowIds) ? $rowIds : null);

        return response()->json($result);
    }

    /**
     * Bulk apply resolution for atypic rows:
     * - "delete": remove from case
     * - "move_to_sources": flag as is_catalog=true and keep for deep crawl
     * - "unflag": mark as target (verified by user)
     * - "blacklist": add domains to blacklist and delete from case
     *
     * POST /api/cases/{id}/resolve-relevance
     */
    public function resolve(Request $request, string $id): JsonResponse
    {
        $validated = $request->validate([
            'action' => 'required|string|in:delete,move_to_sources,unflag,blacklist',
            'rowIds' => 'required|array',
            'rowIds.*' => 'string',
        ]);

        $case = DataCase::findOrFail($id);
        $action = $validated['action'];
        $rowIds = $validated['rowIds'];

        $rows = Row::where('case_id', $case->id)->whereIn('id', $rowIds)->get();
        $affectedCount = 0;

        if ($action === 'delete') {
            $affectedCount = Row::where('case_id', $case->id)->whereIn('id', $rowIds)->delete();
        } elseif ($action === 'move_to_sources') {
            foreach ($rows as $r) {
                $d = $r->data ?? [];
                $d['is_catalog'] = 'true';
                $d['relevance_type'] = 'catalog';
                $r->update(['data' => $d]);
                $affectedCount++;
            }
        } elseif ($action === 'unflag') {
            foreach ($rows as $r) {
                $d = $r->data ?? [];
                $d['relevance_type'] = 'target';
                $d['is_target'] = true;
                $d['user_verified'] = true;
                $d['relevance_reason'] = 'Manuell bestätigt';
                $r->update(['data' => $d]);
                $affectedCount++;
            }
        } elseif ($action === 'blacklist') {
            $learnedDomains = [];
            foreach ($rows as $r) {
                $d = $r->data ?? [];
                $domain = $d['domain'] ?? '';
                if ($domain) {
                    $clean = strtolower(trim(preg_replace('/^https?:\/\//', '', $domain)));
                    $clean = preg_replace('/\/.*$/', '', $clean);
                    $clean = preg_replace('/^www\./', '', $clean);

                    if ($clean && !in_array($clean, $learnedDomains)) {
                        $learnedDomains[] = $clean;
                        try {
                            BlacklistDomain::firstOrCreate(
                                ['domain' => $clean],
                                [
                                    'reason' => 'Atypisches Ergebnis / Dachverband / Portal (' . ($d['relevance_reason'] ?? 'KI-Filter') . ')',
                                    'source' => 'case_relevance_review',
                                ]
                            );
                        } catch (\Throwable $e) {}
                    }
                }
            }
            // Also delete the rows from the case
            $affectedCount = Row::where('case_id', $case->id)->whereIn('id', $rowIds)->delete();
        }

        return response()->json([
            'ok' => true,
            'action' => $action,
            'affected' => $affectedCount,
            'message' => "{$affectedCount} Zeilen erfolgreich verarbeitet.",
        ]);
    }
}

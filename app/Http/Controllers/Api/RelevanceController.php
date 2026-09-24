<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
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

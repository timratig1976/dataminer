<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Row;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DeduplicationController extends Controller
{
    /**
     * Deduplicate rows in a case by domain > source_domain > company_name.
     * Keeps the row with the most filled data fields.
     * POST /api/cases/{id}/dedupe
     */
    public function dedupe(string $id): JsonResponse
    {
        $allRows = Row::where('case_id', $id)->get();

        $groups = [];
        foreach ($allRows as $row) {
            $data = $row->data ?? [];
            if (!empty($data['_parent_row_id'])) {
                continue; // sub-rows skip
            }

            $key = strtolower(trim($data['domain'] ?? $data['source_domain'] ?? $data['company_name'] ?? $row->id));
            if (empty($key)) continue;

            $groups[$key][] = $row;
        }

        $toDelete = [];
        foreach ($groups as $group) {
            if (count($group) <= 1) continue;

            // Sort by number of filled fields descending
            usort($group, function ($a, $b) {
                $aFilled = count(array_filter($a->data ?? [], fn($v, $k) => !empty($v) && !str_starts_with($k, '_'), ARRAY_FILTER_USE_BOTH));
                $bFilled = count(array_filter($b->data ?? [], fn($v, $k) => !empty($v) && !str_starts_with($k, '_'), ARRAY_FILTER_USE_BOTH));
                return $bFilled <=> $aFilled;
            });

            // Keep the first (best), delete the rest
            for ($i = 1; $i < count($group); $i++) {
                $toDelete[] = $group[$i]->id;
            }
        }

        if (!empty($toDelete)) {
            Row::whereIn('id', $toDelete)->delete();
        }

        return response()->json([
            'removed' => count($toDelete),
            'remaining' => $allRows->count() - count($toDelete),
        ]);
    }
}

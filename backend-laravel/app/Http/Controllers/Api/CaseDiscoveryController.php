<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DataCase;
use App\Models\GlobalSetting;
use App\Models\Row;
use App\Services\DiscoveryService;
use App\Services\PlannerService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class CaseDiscoveryController extends Controller
{
    /**
     * Generate discovery plan for a case.
     * POST /api/cases/{id}/plan
     */
    public function plan(Request $request, string $id, PlannerService $planner): JsonResponse
    {
        $case = DataCase::findOrFail($id);
        $goal = $request->input('goal') ?: $case->name;
        $maxResults = (int) $request->input('maxResults', 100);
        $sourceMode = (string) $request->input('sourceMode', 'gmb_first');

        $plan = $planner->createPlan(
            userGoal: $goal,
            maxResults: $maxResults,
            sourceMode: $sourceMode,
            caseId: $case->id
        );
        return response()->json($plan);
    }

    /**
     * Direct discovery execution (Web or Maps) and append new rows.
     * POST /api/cases/{id}/discover
     */
    public function discover(Request $request, string $id, DiscoveryService $discovery): JsonResponse
    {
        $case = DataCase::findOrFail($id);
        $query = $request->input('query');
        $type = $request->input('type', 'web'); // web or maps
        $limit = min((int) $request->input('limit', 100), 100);

        if (empty($query)) {
            return response()->json(['error' => 'query required'], 400);
        }

        if ($type === 'maps') {
            $location = $request->input('location');
            $res = $discovery->discoverMaps($case->id, $query, $location, $limit);
        } else {
            $res = $discovery->discoverWeb($case->id, $query, $limit);
        }

        return response()->json([
            'success' => true,
            'result' => $res,
        ]);
    }

    /**
     * Append rows directly to a case.
     * POST /api/cases/{id}/append
     */
    public function append(Request $request, string $id): JsonResponse
    {
        $case = DataCase::findOrFail($id);
        $newRows = $request->input('rows', []);

        if (empty($newRows) || !is_array($newRows)) {
            return response()->json(['error' => 'rows array required'], 400);
        }

        $existingCount = Row::where('case_id', $case->id)->count();
        $batch = [];

        foreach ($newRows as $idx => $data) {
            $batch[] = [
                'id' => (string) Str::uuid(),
                'case_id' => $case->id,
                'row_index' => $existingCount + $idx,
                'data' => json_encode($data),
                'cell_statuses' => json_encode([]),
                'cell_errors' => json_encode([]),
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }

        Row::insert($batch);

        return response()->json([
            'success' => true,
            'added' => count($batch),
            'total_rows' => $existingCount + count($batch),
        ]);
    }

    /**
     * Add column shortcut.
     * POST /api/cases/{id}/add-column
     */
    public function addColumn(Request $request, string $id): JsonResponse
    {
        $case = DataCase::findOrFail($id);
        $column = $request->input('column');

        if (!$column || !isset($column['name'])) {
            return response()->json(['error' => 'column definition required'], 400);
        }

        $existing = $case->ai_columns ?? [];
        if (empty($column['id'])) {
            $column['id'] = (string) Str::uuid();
        }
        $existing[] = $column;

        $case->update(['ai_columns' => $existing]);
        return response()->json(['ok' => true, 'case' => $case]);
    }

    /**
     * Delete column shortcut (AI column or Data column from all rows).
     * POST /api/cases/{id}/delete-column
     */
    public function deleteColumn(Request $request, string $id): JsonResponse
    {
        $case = DataCase::findOrFail($id);
        $columnId = $request->input('columnId');
        $isDataKey = (bool) $request->input('isDataKey', false);

        if ($isDataKey) {
            // Delete this key from all rows of this case
            $rows = \App\Models\Row::where('case_id', $case->id)->get();
            foreach ($rows as $row) {
                $data = $row->data ?? [];
                if (array_key_exists($columnId, $data)) {
                    unset($data[$columnId]);
                    $row->update(['data' => $data]);
                }
            }

            // Also remove from col_order and columns so the header dropdown immediately reflects the change
            $colOrder = $case->col_order ?? [];
            if (in_array($columnId, $colOrder)) {
                $case->update(['col_order' => array_values(array_filter($colOrder, fn($k) => $k !== $columnId))]);
            }

            $columns = $case->columns ?? [];
            if (!empty($columns)) {
                $case->update(['columns' => array_values(array_filter($columns, fn($c) => is_array($c) ? (($c['key'] ?? '') !== $columnId) : ($c !== $columnId)))]);
            }

            return response()->json(['ok' => true, 'message' => "Spalte '{$columnId}' aus allen Zeilen und Spaltenlisten gelöscht.", 'case' => $case->fresh()]);
        }

        $existing = $case->ai_columns ?? [];
        $filtered = array_values(array_filter($existing, fn($c) => ($c['id'] ?? '') !== $columnId && ($c['outputKey'] ?? '') !== $columnId));

        $case->update(['ai_columns' => $filtered]);
        return response()->json(['ok' => true, 'case' => $case]);
    }
}

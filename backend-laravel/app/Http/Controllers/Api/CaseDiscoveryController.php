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

        $plan = $planner->createPlan($goal);
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
        $limit = min((int) $request->input('limit', 20), 50);

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
     * Delete column shortcut.
     * POST /api/cases/{id}/delete-column
     */
    public function deleteColumn(Request $request, string $id): JsonResponse
    {
        $case = DataCase::findOrFail($id);
        $columnId = $request->input('columnId');

        $existing = $case->ai_columns ?? [];
        $filtered = array_values(array_filter($existing, fn($c) => ($c['id'] ?? '') !== $columnId && ($c['outputKey'] ?? '') !== $columnId));

        $case->update(['ai_columns' => $filtered]);
        return response()->json(['ok' => true, 'case' => $case]);
    }
}

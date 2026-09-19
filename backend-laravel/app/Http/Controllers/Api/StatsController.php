<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DataCase;
use App\Models\Row;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class StatsController extends Controller
{
    public function index(): JsonResponse
    {
        $cases = DataCase::all();
        $totalCases = $cases->count();
        $totalRows = Row::count();

        $caseStats = [];
        $totalCells = 0;
        $doneCells = 0;
        $errorCells = 0;
        $totalCostUsd = 0.0;

        foreach ($cases as $case) {
            $rowCount = Row::where('case_id', $case->id)->count();
            $aiCols = $case->ai_columns ?? [];
            $aiColCount = count($aiCols);

            $caseCells = $rowCount * $aiColCount;
            $totalCells += $caseCells;

            // Simple aggregate estimation
            $caseStats[] = [
                'id' => $case->id,
                'name' => $case->name,
                'rowCount' => $rowCount,
                'aiColumnCount' => $aiColCount,
                'doneCells' => 0,
                'errorCells' => 0,
                'costUsd' => 0.0,
                'updatedAt' => $case->updated_at?->toIso8601String() ?? now()->toIso8601String(),
            ];
        }

        return response()->json([
            'totalCases' => $totalCases,
            'totalRows' => $totalRows,
            'totalCells' => $totalCells,
            'doneCells' => $doneCells,
            'errorCells' => $errorCells,
            'totalCostUsd' => $totalCostUsd,
            'cases' => $caseStats,
        ]);
    }
}

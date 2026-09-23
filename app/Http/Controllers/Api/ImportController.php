<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\ImportService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ImportController extends Controller
{
    protected ImportService $importService;

    public function __construct(ImportService $importService)
    {
        $this->importService = $importService;
    }

    /**
     * Import CSV content into a given Case.
     * POST /api/import/csv
     */
    public function importCsv(Request $request): JsonResponse
    {
        $request->validate([
            'case_id' => 'required|uuid|exists:cases,id',
            'csv' => 'required_without:file|string',
            'file' => 'required_without:csv|file|mimes:csv,txt',
            'column_mapping' => 'nullable|array',
        ]);

        $csvContent = $request->input('csv');
        if ($request->hasFile('file')) {
            $csvContent = file_get_contents($request->file('file')->getRealPath());
        }

        $result = $this->importService->importCsv(
            $request->input('case_id'),
            $csvContent,
            $request->input('column_mapping')
        );

        return response()->json([
            'message' => 'CSV imported successfully',
            'result' => $result,
        ]);
    }

    /**
     * Restore a case from a JSON snapshot.
     * POST /api/import/snapshot
     */
    public function importSnapshot(Request $request): JsonResponse
    {
        $snapshot = $request->all();
        if (empty($snapshot)) {
            return response()->json(['error' => 'Snapshot data is empty'], 400);
        }

        $case = $this->importService->importSnapshot($snapshot);

        return response()->json([
            'message' => 'Snapshot restored successfully',
            'case' => $case->loadCount('rows'),
        ], 201);
    }

    /**
     * Import XLSX/XLS/ODS file into a given Case.
     * POST /api/import/xlsx
     */
    public function importXlsx(Request $request): JsonResponse
    {
        $request->validate([
            'case_id' => 'required|uuid|exists:cases,id',
            'file' => 'required|file|mimes:xlsx,xls,ods,csv',
            'column_mapping' => 'nullable|array',
        ]);

        $path = $request->file('file')->getRealPath();

        $result = $this->importService->importXlsx(
            $request->input('case_id'),
            $path,
            $request->input('column_mapping')
        );

        return response()->json([
            'message' => 'XLSX imported successfully',
            'result' => $result,
        ]);
    }
}

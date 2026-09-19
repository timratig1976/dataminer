<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DataCase;
use App\Models\Row;
use App\Models\ContactRow;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ExportController extends Controller
{
    public function exportCsv(Request $request)
    {
        $caseId = $request->query('caseId');
        $type = $request->query('type', 'companies');
        $colsParam = $request->query('cols');
        $requestedCols = $colsParam ? explode(',', $colsParam) : null;

        if (!$caseId) {
            return response()->json(['error' => 'caseId required'], 400);
        }

        $case = DataCase::find($caseId);
        if (!$case) {
            return response()->json(['error' => 'Case not found'], 404);
        }

        $headers = [
            'Content-Type' => 'text/csv; charset=utf-8',
            'Content-Disposition' => "attachment; filename=\"{$case->name}.csv\"",
        ];

        return new StreamedResponse(function () use ($caseId, $requestedCols, $case) {
            $handle = fopen('php://output', 'w');

            $rows = Row::where('case_id', $caseId)->orderBy('row_index', 'asc')->get();
            if ($rows->isEmpty()) {
                fclose($handle);
                return;
            }

            // Determine headers
            $allKeys = [];
            foreach ($rows as $r) {
                foreach (array_keys($r->data ?? []) as $k) {
                    if (!str_starts_with($k, '_') && !in_array($k, $allKeys)) {
                        $allKeys[] = $k;
                    }
                }
            }

            $exportHeaders = $requestedCols ?: $allKeys;
            fputcsv($handle, $exportHeaders);

            foreach ($rows as $row) {
                $line = [];
                foreach ($exportHeaders as $h) {
                    $line[] = $row->data[$h] ?? '';
                }
                fputcsv($handle, $line);
            }

            fclose($handle);
        }, 200, $headers);
    }

    /**
     * Export complete case as JSON snapshot.
     * GET /api/export/snapshot?caseId=...
     */
    public function exportSnapshot(Request $request)
    {
        $caseId = $request->query('caseId');
        if (!$caseId) {
            return response()->json(['error' => 'caseId required'], 400);
        }

        $case = DataCase::find($caseId);
        if (!$case) {
            return response()->json(['error' => 'Case not found'], 404);
        }

        $rows = Row::where('case_id', $caseId)->orderBy('row_index', 'asc')->get();
        $contacts = ContactRow::where('case_id', $caseId)->get();

        $snapshot = [
            '_version' => 2,
            'exportedAt' => now()->toIso8601String(),
            'case' => [
                'id' => $case->id,
                'name' => $case->name,
                'description' => $case->description,
                'columns' => $case->columns,
                'ai_columns' => $case->ai_columns,
                'col_order' => $case->col_order,
                'eden_region' => $case->eden_region,
            ],
            'rows' => $rows->map(fn($r) => [
                'id' => $r->id,
                'row_index' => $r->row_index,
                'data' => $r->data,
                'cell_statuses' => $r->cell_statuses,
                'cell_errors' => $r->cell_errors,
            ]),
            'contacts' => $contacts->map(fn($c) => [
                'id' => $c->id,
                'data' => $c->data,
                'cell_statuses' => $c->cell_statuses,
                'cell_errors' => $c->cell_errors,
            ]),
        ];

        $safeName = preg_replace('/[^a-z0-9]/i', '_', $case->name);
        $filename = "{$safeName}_snapshot.json";

        return response()->json($snapshot, 200, [
            'Content-Type' => 'application/json; charset=utf-8',
            'Content-Disposition' => "attachment; filename=\"{$filename}\"",
        ]);
    }
}

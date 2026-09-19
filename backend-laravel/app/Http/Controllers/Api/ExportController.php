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
}

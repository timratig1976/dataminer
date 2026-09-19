<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DataCase;
use App\Models\Row;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class GroupedRowsController extends Controller
{
    /**
     * List rows grouped by company_name for hierarchical table rendering.
     * GET /api/rows/grouped?caseId=...
     */
    public function index(Request $request): JsonResponse
    {
        $caseId = $request->query('caseId');
        if (!$caseId) {
            return response()->json(['error' => 'caseId required'], 400);
        }

        $page = max(1, (int) $request->query('page', 1));
        $perPage = min(200, max(10, (int) $request->query('perPage', 50)));
        $offset = ($page - 1) * $perPage;

        // Distinct companies count
        $totalCompanies = DB::table('rows')
            ->where('case_id', $caseId)
            ->whereNotNull(DB::raw("data->>'company_name'"))
            ->whereRaw("data->>'company_name' != ''")
            ->distinct()
            ->count(DB::raw("data->>'company_name'"));

        // Server-side grouping via PostgreSQL json_agg
        $groups = DB::select("
            SELECT 
                data->>'company_name' as company_name,
                json_agg(
                    json_build_object(
                        'id', id,
                        'case_id', case_id,
                        'row_index', row_index,
                        'data', data,
                        'cell_statuses', cell_statuses,
                        'cell_errors', cell_errors,
                        'created_at', created_at,
                        'updated_at', updated_at
                    ) ORDER BY row_index ASC
                ) as rows_json
            FROM rows
            WHERE case_id = ?
              AND data->>'company_name' IS NOT NULL
              AND data->>'company_name' != ''
            GROUP BY data->>'company_name'
            ORDER BY MIN(row_index) ASC
            LIMIT ? OFFSET ?
        ", [$caseId, $perPage, $offset]);

        $companies = array_map(function ($g) {
            $rows = json_decode($g->rows_json, true) ?? [];
            return [
                'companyName' => $g->company_name,
                'companyRow' => $rows[0] ?? null,
                'contacts' => array_slice($rows, 1),
            ];
        }, $groups);

        return response()->json([
            'companies' => $companies,
            'totalCompanies' => $totalCompanies,
            'page' => $page,
            'perPage' => $perPage,
        ]);
    }
}

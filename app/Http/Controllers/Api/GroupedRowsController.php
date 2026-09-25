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

        $driver = DB::getDriverName();

        if ($driver === 'pgsql') {
            // PostgreSQL: efficient server-side grouping
            $totalCompanies = DB::table('rows')
                ->where('case_id', $caseId)
                ->whereRaw("data->>'company_name' IS NOT NULL AND data->>'company_name' != ''")
                ->distinct()
                ->count(DB::raw("data->>'company_name'"));

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
                    'companyRow'  => $rows[0] ?? null,
                    'contacts'    => array_slice($rows, 1),
                ];
            }, $groups);
        } else {
            // SQLite / other: fetch all rows for this case, group in PHP
            $allRows = DB::table('rows')
                ->where('case_id', $caseId)
                ->orderBy('row_index')
                ->get();

            // Group by company_name in PHP
            $grouped = [];
            $order   = [];
            foreach ($allRows as $row) {
                $data = is_string($row->data) ? json_decode($row->data, true) : (array) $row->data;
                $company = trim($data['company_name'] ?? '');
                if ($company === '') continue;
                if (!isset($grouped[$company])) {
                    $grouped[$company] = [];
                    $order[] = $company;
                }
                $grouped[$company][] = [
                    'id'           => $row->id,
                    'case_id'      => $row->case_id,
                    'row_index'    => $row->row_index,
                    'data'         => $data,
                    'cell_statuses'=> is_string($row->cell_statuses) ? json_decode($row->cell_statuses, true) : (array) $row->cell_statuses,
                    'cell_errors'  => is_string($row->cell_errors)   ? json_decode($row->cell_errors, true)   : (array) $row->cell_errors,
                    'created_at'   => $row->created_at,
                    'updated_at'   => $row->updated_at,
                ];
            }

            $totalCompanies = count($order);
            $pageKeys = array_slice($order, $offset, $perPage);

            $companies = array_map(function ($company) use ($grouped) {
                $rows = $grouped[$company];
                return [
                    'companyName' => $company,
                    'companyRow'  => $rows[0] ?? null,
                    'contacts'    => array_slice($rows, 1),
                ];
            }, $pageKeys);
        }

        return response()->json([
            'companies' => $companies,
            'totalCompanies' => $totalCompanies,
            'page' => $page,
            'perPage' => $perPage,
        ]);
    }
}

<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Row;
use App\Models\DataCase;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class RowController extends Controller
{
    public function index(Request $request)
    {
        $caseId = $request->query('caseId');
        if (!$caseId) {
            return response()->json(['error' => 'caseId required'], 400);
        }

        $rows = Row::where('case_id', $caseId)
            ->orderBy('row_index', 'asc')
            ->get();

        return response()->json($rows);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'case_id' => 'required|string',
            'data' => 'required|array',
            'row_index' => 'nullable|integer',
        ]);

        $maxIndex = Row::where('case_id', $validated['case_id'])->max('row_index') ?? -1;

        $row = Row::create([
            'id' => (string) Str::uuid(),
            'case_id' => $validated['case_id'],
            'row_index' => $validated['row_index'] ?? ($maxIndex + 1),
            'data' => $validated['data'],
            'cell_statuses' => [],
            'cell_errors' => [],
        ]);

        return response()->json($row, 201);
    }

    public function update(Request $request, string $id)
    {
        $row = Row::find($id);
        if (!$row) {
            return response()->json(['error' => 'Not found'], 404);
        }

        $row->update($request->only([
            'data',
            'cell_statuses',
            'cell_errors',
        ]));

        return response()->json($row);
    }

    public function destroy(Request $request)
    {
        $ids = $request->input('ids');
        if (!is_array($ids) || empty($ids)) {
            return response()->json(['error' => 'ids array required'], 400);
        }

        $deleted = Row::whereIn('id', $ids)->delete();
        return response()->json(['ok' => true, 'deleted' => $deleted]);
    }
}

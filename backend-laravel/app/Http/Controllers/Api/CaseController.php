<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DataCase;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class CaseController extends Controller
{
    public function index()
    {
        return response()->json(DataCase::withCount('rows')->orderBy('updated_at', 'desc')->get());
    }

    public function show(string $id)
    {
        $case = DataCase::withCount('rows')->find($id);
        if (!$case) {
            return response()->json(['error' => 'Not found'], 404);
        }
        return response()->json($case);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'ai_columns' => 'nullable|array',
            'col_order' => 'nullable|array',
        ]);

        $case = DataCase::create([
            'id' => (string) Str::uuid(),
            'name' => $validated['name'],
            'ai_columns' => $validated['ai_columns'] ?? [],
            'col_order' => $validated['col_order'] ?? [],
            'eden_region' => 'us',
        ]);

        return response()->json($case, 201);
    }

    public function update(Request $request, string $id)
    {
        $case = DataCase::find($id);
        if (!$case) {
            return response()->json(['error' => 'Not found'], 404);
        }

        $case->update($request->only([
            'name',
            'ai_columns',
            'col_order',
            'eden_api_key',
            'eden_region',
            'model_allowlist',
        ]));

        return response()->json($case);
    }

    public function destroy(string $id)
    {
        $case = DataCase::find($id);
        if (!$case) {
            return response()->json(['error' => 'Not found'], 404);
        }

        $case->delete();
        return response()->json(['ok' => true]);
    }
}

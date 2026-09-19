<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DataCase;
use App\Services\TemplateService;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class CaseController extends Controller
{
    public function index()
    {
        return response()->json(DataCase::withCount('rows')->orderBy('updated_at', 'desc')->get());
    }

    public function templates()
    {
        return response()->json(TemplateService::getTemplates());
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
            'description' => 'nullable|string',
            'template' => 'nullable|string',
            'columns' => 'nullable|array',
            'ai_columns' => 'nullable|array',
            'col_order' => 'nullable|array',
        ]);

        $columns = $validated['columns'] ?? [];
        $aiColumns = $validated['ai_columns'] ?? [];
        $colOrder = $validated['col_order'] ?? [];

        // Apply template if chosen
        $templateId = $validated['template'] ?? 'standard';
        if ($templateId && empty($columns) && empty($aiColumns)) {
            $allTemplates = TemplateService::getTemplates();
            $tpl = collect($allTemplates)->firstWhere('id', $templateId);
            if ($tpl) {
                $columns = array_map(fn($bc) => [
                    'id' => (string) Str::uuid(),
                    'key' => $bc['outputKey'],
                    'label' => $bc['name'],
                    'type' => 'text',
                ], $tpl['baseColumns'] ?? []);

                $aiColumns = $tpl['aiColumns'] ?? [];
                $colOrder = array_map(fn($c) => $c['key'], $columns);
            }
        }

        $case = DataCase::create([
            'id' => (string) Str::uuid(),
            'name' => $validated['name'],
            'description' => $validated['description'] ?? null,
            'columns' => $columns,
            'ai_columns' => $aiColumns,
            'col_order' => $colOrder,
            'eden_region' => 'eu',
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

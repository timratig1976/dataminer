<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\NormalizationPrompt;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class NormalizationPromptController extends Controller
{
    public function index(): JsonResponse
    {
        $prompts = NormalizationPrompt::orderBy('schema_type')
            ->orderBy('version', 'desc')
            ->get();

        return response()->json($prompts);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:100',
            'description' => 'nullable|string',
            'schema_type' => 'required|string|in:*,contact-first,company-first,mixed',
            'system_prompt' => 'required|string',
            'user_prompt_template' => 'required|string',
            'model' => 'nullable|string|max:100',
            'max_tokens' => 'nullable|integer|min:100|max:16000',
            'temperature' => 'nullable|numeric|min:0|max:1',
            'max_rows_per_chunk' => 'nullable|integer|min:1|max:50',
            'is_active' => 'nullable|boolean',
        ]);

        $latestVersion = NormalizationPrompt::where('name', $validated['name'])->max('version') ?? 0;
        $validated['version'] = $latestVersion + 1;

        if (!empty($validated['is_active'])) {
            NormalizationPrompt::where('schema_type', $validated['schema_type'])->update(['is_active' => false]);
        }

        $prompt = NormalizationPrompt::create($validated);

        return response()->json($prompt, 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $prompt = NormalizationPrompt::findOrFail($id);

        $validated = $request->validate([
            'description' => 'nullable|string',
            'system_prompt' => 'sometimes|string',
            'user_prompt_template' => 'sometimes|string',
            'model' => 'sometimes|string|max:100',
            'max_tokens' => 'sometimes|integer|min:100|max:16000',
            'temperature' => 'sometimes|numeric|min:0|max:1',
            'max_rows_per_chunk' => 'sometimes|integer|min:1|max:50',
        ]);

        $prompt->update($validated);

        return response()->json($prompt);
    }

    public function activate(string $id): JsonResponse
    {
        $prompt = NormalizationPrompt::findOrFail($id);

        DB::transaction(function () use ($prompt) {
            NormalizationPrompt::where('schema_type', $prompt->schema_type)
                ->update(['is_active' => false]);

            $prompt->update(['is_active' => true]);
        });

        return response()->json([
            'message' => "Prompt '{$prompt->name}' (v{$prompt->version}) aktiviert.",
            'prompt' => $prompt->fresh(),
        ]);
    }

    public function destroy(string $id): JsonResponse
    {
        $prompt = NormalizationPrompt::findOrFail($id);

        if ($prompt->is_active) {
            return response()->json(['error' => 'Aktive Prompts können nicht gelöscht werden.'], 422);
        }

        $prompt->delete();

        return response()->json(['message' => 'Prompt gelöscht.']);
    }
}

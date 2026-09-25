<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\GlobalSetting;
use App\Services\PresetService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class PresetController extends Controller
{
    /**
     * GET /api/presets/all
     * Returns built-in presets + user-created custom presets.
     */
    public function index(): JsonResponse
    {
        $builtIn = collect(PresetService::getPresets())->map(function ($p) {
            return array_merge($p, [
                'id'       => 'builtin__' . ($p['outputKey'] ?? Str::slug($p['name'])),
                'isBuiltIn' => true,
            ]);
        })->values()->all();

        $settings = GlobalSetting::instance();
        $custom = collect($settings->custom_presets ?? [])->map(function ($p) {
            return array_merge($p, ['isBuiltIn' => false]);
        })->values()->all();

        return response()->json([
            'builtIn' => $builtIn,
            'custom'  => $custom,
        ]);
    }

    /**
     * POST /api/presets/custom
     * Create a new custom preset.
     */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name'           => 'required|string|max:100',
            'outputKey'      => 'required|string|max:100',
            'prompt'         => 'nullable|string',
            'model'          => 'nullable|string|max:100',
            'outputMode'     => 'nullable|string|in:text,json',
            'jsonKey'        => 'nullable|string|max:100',
            'condition'      => 'nullable|string|max:50',
            'conditionField' => 'nullable|string|max:100',
            'tool'           => 'nullable|string|max:50',
            'description'    => 'nullable|string|max:300',
            'tags'           => 'nullable|array',
            'tags.*'         => 'string|max:50',
        ]);

        $settings = GlobalSetting::instance();
        $custom = $settings->custom_presets ?? [];

        $preset = array_merge($data, [
            'id'         => Str::uuid()->toString(),
            'isBuiltIn'  => false,
            'created_at' => now()->toISOString(),
        ]);

        $custom[] = $preset;
        $settings->custom_presets = $custom;
        $settings->save();

        return response()->json($preset, 201);
    }

    /**
     * PUT /api/presets/custom/{id}
     * Update an existing custom preset.
     */
    public function update(Request $request, string $id): JsonResponse
    {
        $data = $request->validate([
            'name'           => 'sometimes|string|max:100',
            'outputKey'      => 'sometimes|string|max:100',
            'prompt'         => 'nullable|string',
            'model'          => 'nullable|string|max:100',
            'outputMode'     => 'nullable|string|in:text,json',
            'jsonKey'        => 'nullable|string|max:100',
            'condition'      => 'nullable|string|max:50',
            'conditionField' => 'nullable|string|max:100',
            'tool'           => 'nullable|string|max:50',
            'description'    => 'nullable|string|max:300',
            'tags'           => 'nullable|array',
            'tags.*'         => 'string|max:50',
        ]);

        $settings = GlobalSetting::instance();
        $custom = $settings->custom_presets ?? [];

        $found = false;
        $updated = null;
        foreach ($custom as &$p) {
            if (($p['id'] ?? '') === $id) {
                $p = array_merge($p, $data, ['updated_at' => now()->toISOString()]);
                $updated = $p;
                $found = true;
                break;
            }
        }
        unset($p);

        if (!$found) {
            return response()->json(['error' => 'Preset not found'], 404);
        }

        $settings->custom_presets = $custom;
        $settings->save();

        return response()->json($updated);
    }

    /**
     * DELETE /api/presets/custom/{id}
     * Delete a custom preset.
     */
    public function destroy(string $id): JsonResponse
    {
        $settings = GlobalSetting::instance();
        $custom = $settings->custom_presets ?? [];

        $filtered = array_values(array_filter($custom, fn($p) => ($p['id'] ?? '') !== $id));

        if (count($filtered) === count($custom)) {
            return response()->json(['error' => 'Preset not found'], 404);
        }

        $settings->custom_presets = $filtered;
        $settings->save();

        return response()->json(['message' => 'Preset gelöscht']);
    }
}

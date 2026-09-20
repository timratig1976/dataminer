<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\TemplateService;
use App\Models\GlobalSetting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TemplateController extends Controller
{
    /**
     * List all templates (built-in + user-saved).
     * GET /api/templates
     */
    public function index(): JsonResponse
    {
        return response()->json(TemplateService::getTemplates());
    }

    /**
     * Save an existing Case as a new reusable Template.
     * POST /api/templates/from-case
     */
    public function saveFromCase(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'case_id' => 'required|uuid|exists:cases,id',
            'name' => 'required|string|max:100',
            'description' => 'nullable|string|max:300',
        ]);

        $template = TemplateService::saveCaseAsTemplate(
            $validated['case_id'],
            $validated['name'],
            $validated['description'] ?? null
        );

        return response()->json([
            'message' => 'Vorlage erfolgreich gespeichert',
            'template' => $template,
        ], 201);
    }

    /**
     * Delete a custom template.
     * DELETE /api/templates/{id}
     */
    public function destroy(string $id): JsonResponse
    {
        $settings = GlobalSetting::instance();
        $custom = $settings->custom_templates ?? [];

        $filtered = array_values(array_filter($custom, fn($t) => ($t['id'] ?? '') !== $id));
        $settings->custom_templates = $filtered;
        $settings->save();

        return response()->json(['message' => 'Vorlage gelöscht']);
    }
}

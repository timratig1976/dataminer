<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DataCase;
use App\Models\GlobalSetting;
use App\Services\EdenAiService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SubIndustryController extends Controller
{
    /**
     * Analyse a research prompt and return sub-industry suggestions.
     * POST /api/cases/{id}/sub-industries
     */
    public function analyse(
        Request $request,
        string $id,
        EdenAiService $edenAi
    ): JsonResponse {
        $case = DataCase::findOrFail($id);
        $prompt = $request->input('prompt');

        if (empty(trim($prompt))) {
            return response()->json(['error' => 'prompt required'], 400);
        }

        $global = GlobalSetting::instance();
        $apiKey = $case->eden_api_key ?: ($global->eden_api_key ?: env('EDEN_API_KEY'));
        if (!$apiKey) {
            return response()->json(['error' => 'No Eden API key configured'], 400);
        }

        $systemPrompt = "Du bist ein B2B-Marktrecherche-Experte. Zerlege das gegebene Ziel in 4-8 relevante Teilbranchen, Gewerke oder Nischen. Antworte NUR als JSON-Array mit Objekten: [{\"id\": \"slug\", \"label\": \"Name\", \"query\": \"Suchbegriff\"}]";

        try {
            $resp = $edenAi->chatCompletion(
                apiKey: $apiKey,
                model: $request->input('model', 'openai/gpt-4o-mini'),
                systemPrompt: $systemPrompt,
                userPrompt: "Ziel: {$prompt}"
            );

            $raw = trim(preg_replace('/^```(?:json)?\n?/i', '', preg_replace('/\n?```$/i', '', $resp['raw'])));
            $items = json_decode($raw, true) ?? [];

            return response()->json([
                'sub_industries' => $items,
                'count' => count($items),
            ]);
        } catch (\Throwable $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }
}

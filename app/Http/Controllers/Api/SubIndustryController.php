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

        $systemPrompt = "Du bist ein B2B-Recherche-Analyst. Deine Aufgabe: Analysiere ob eine Suchanfrage eine breite Branche umfasst.\n"
            . "Wenn JA: Zerlege in spezifische Sub-Branchen (NUR Branchen-Namen, KEINE Städte im mapQuery).\n"
            . "Erkenne IMMER die Geographie aus der Anfrage:\n"
            . "- Einzelne Stadt → geography = Stadtname, cities = [Stadtname]\n"
            . "- Region/Bundesland (z.B. \"Mecklenburg-Vorpommern\", \"MV\", \"Bayern\", \"NRW\") → geography = Regionsname, cities = ALLE Städte dieser Region recherchieren und vollständig aufzählen (15-50 Städte). Keine Stadt auslassen. Städte nur im cities-Array, NICHT in suggestions.mapQuery.\n"
            . "- Gesamtes Land (z.B. \"Deutschland\") → geography = \"Deutschland\", cities = [] (zu viele Städte für Liste)\n\n"
            . "Gib JSON zurück:\n"
            . "{\n"
            . "  \"isBroadIndustry\": true,\n"
            . "  \"geography\": \"Region oder null\",\n"
            . "  \"cities\": [\"Stadt1\", \"Stadt2\"],\n"
            . "  \"suggestions\": [\n"
            . "    {\"mapQuery\": \"Sub-Branche (OHNE Stadt)\", \"label\": \"Anzeigename\", \"description\": \"kurze Beschreibung\", \"estimatedSize\": \"groß|mittel|klein\"}\n"
            . "  ]\n"
            . "}";

        try {
            $region = $global->eden_region ?: 'eu';
            $defaultModel = $region === 'eu' ? 'mistral/mistral-small-latest' : 'openai/gpt-4o-mini';
            $model = $request->input('model', $defaultModel);

            $resp = $edenAi->chatCompletion(
                apiKey: $apiKey,
                model: $model,
                system: $systemPrompt,
                prompt: "Analyse: {$prompt}",
                region: $region
            );

            $raw = trim(preg_replace('/^```(?:json)?\n?/i', '', preg_replace('/\n?```$/i', '', $resp['raw'] ?? '')));
            $parsed = json_decode($raw, true) ?? [];

            $suggestions = array_map(function ($s) {
                return [
                    'mapQuery' => (string) ($s['mapQuery'] ?? $s['query'] ?? ''),
                    'label' => (string) ($s['label'] ?? $s['mapQuery'] ?? $s['name'] ?? ''),
                    'description' => (string) ($s['description'] ?? ''),
                    'estimatedSize' => (string) ($s['estimatedSize'] ?? 'mittel'),
                    'selected' => false,
                ];
            }, $parsed['suggestions'] ?? $parsed['sub_industries'] ?? []);

            return response()->json([
                'isBroadIndustry' => (bool) ($parsed['isBroadIndustry'] ?? count($suggestions) > 0),
                'geography' => $parsed['geography'] ?? null,
                'cities' => is_array($parsed['cities'] ?? null) ? array_map('strval', $parsed['cities']) : [],
                'suggestions' => $suggestions,
                'sub_industries' => $suggestions,
                'count' => count($suggestions),
            ]);
        } catch (\Throwable $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }
}

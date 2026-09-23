<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DataCase;
use App\Models\GlobalSetting;
use App\Models\Row;
use App\Services\EdenAiService;
use App\Services\SearchService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class SingleCatalogScrapeController extends Controller
{
    /**
     * Scrape a single catalog/directory URL and append found companies to the case.
     * POST /api/cases/{id}/scrape-catalog
     */
    public function scrape(
        Request $request,
        string $id,
        EdenAiService $edenAi,
        SearchService $searchService
    ): JsonResponse {
        $case = DataCase::findOrFail($id);
        $url = $request->input('url');

        if (empty($url) || !filter_var($url, FILTER_VALIDATE_URL)) {
            return response()->json(['error' => 'Gültige URL erforderlich'], 400);
        }

        $global = GlobalSetting::instance();
        $apiKey = $case->eden_api_key ?: ($global->eden_api_key ?: env('EDEN_API_KEY'));
        if (!$apiKey) {
            return response()->json(['error' => 'No Eden API key configured'], 400);
        }

        try {
            $scraped = $edenAi->scrapeUrl($apiKey, $url);
            $md = $scraped['markdown'] ?? '';

            if (strlen($md) < 100) {
                return response()->json([
                    'added' => 0,
                    'message' => 'Die Seite enthielt keinen lesbaren Inhalt oder wurde blockiert.',
                ]);
            }

            $prompt = "Extrahiere alle Firmen, Betriebe oder Dienstleister aus diesem Verzeichnistext. Antworte NUR als JSON-Array: [{\"company_name\": \"...\", \"domain\": \"...\", \"phone\": \"...\", \"city\": \"...\", \"address\": \"...\"}]";
            $res = $edenAi->chatCompletion(
                apiKey: $apiKey,
                model: 'openai/gpt-4o-mini',
                systemPrompt: $prompt,
                userPrompt: substr($md, 0, 8000)
            );

            $raw = trim(preg_replace('/^```(?:json)?\n?/i', '', preg_replace('/\n?```$/i', '', $res['raw'])));
            $companies = json_decode($raw, true) ?? [];

            $existingCount = Row::where('case_id', $case->id)->count();
            $batch = [];

            foreach ($companies as $c) {
                if (empty($c['company_name'])) continue;
                $batch[] = [
                    'id' => (string) Str::uuid(),
                    'case_id' => $case->id,
                    'row_index' => $existingCount++,
                    'data' => json_encode(array_merge($c, [
                        'Quelle' => 'Katalog Scrape',
                        'katalog_url' => $url,
                    ])),
                    'cell_statuses' => json_encode([]),
                    'cell_errors' => json_encode([]),
                    'created_at' => now(),
                    'updated_at' => now(),
                ];
            }

            if (!empty($batch)) {
                Row::insert($batch);
            }

            return response()->json([
                'added' => count($batch),
                'total_rows' => $existingCount,
                'message' => count($batch) . " Unternehmen aus Verzeichnis extrahiert.",
            ]);
        } catch (\Throwable $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * Reflag all rows in a case against known catalog domains.
     * POST /api/cases/{id}/reflag-catalogs
     */
    public function reflag(string $id, SearchService $searchService): JsonResponse
    {
        $case = DataCase::findOrFail($id);
        $rows = Row::where('case_id', $case->id)->get();

        $flaggedCount = 0;
        foreach ($rows as $row) {
            $data = $row->data ?? [];
            $domain = $data['domain'] ?? $data['source_domain'] ?? $data['source_url'] ?? '';

            if ($searchService->isCatalogDomain($domain)) {
                if (empty($data['is_catalog']) || $data['is_catalog'] !== 'true') {
                    $data['is_catalog'] = 'true';
                    $row->update(['data' => $data]);
                    $flaggedCount++;
                }
            }
        }

        return response()->json([
            'flagged' => $flaggedCount,
            'total' => $rows->count(),
            'message' => "{$flaggedCount} Zeilen neu als Verzeichnisse/Kataloge markiert.",
        ]);
    }
}

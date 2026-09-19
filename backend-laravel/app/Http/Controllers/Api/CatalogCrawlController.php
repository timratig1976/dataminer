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

class CatalogCrawlController extends Controller
{
    /**
     * Deep crawl catalog pages and extract company leads.
     * POST /api/cases/{id}/deep-crawl-catalogs
     */
    public function crawl(
        Request $request,
        string $id,
        EdenAiService $edenAi,
        SearchService $searchService
    ): JsonResponse {
        $case = DataCase::findOrFail($id);
        $maxCatalogs = min((int) $request->input('maxCatalogs', 10), 20);

        // Find rows with is_catalog=true
        $catalogs = Row::where('case_id', $case->id)
            ->whereRaw("data->>'is_catalog' = 'true'")
            ->whereNotNull("data->source_url")
            ->limit($maxCatalogs)
            ->get();

        if ($catalogs->isEmpty()) {
            return response()->json([
                'success' => true,
                'message' => 'Keine als Katalog markierten Zeilen gefunden.',
                'added' => 0,
            ]);
        }

        $global = GlobalSetting::instance();
        $apiKey = $case->eden_api_key ?: ($global->eden_api_key ?: env('EDEN_API_KEY'));
        if (!$apiKey) {
            return response()->json(['error' => 'No Eden API key configured'], 400);
        }

        $totalAdded = 0;
        $existingCount = Row::where('case_id', $case->id)->count();

        foreach ($catalogs as $catRow) {
            $catData = $catRow->data ?? [];
            $url = $catData['source_url'] ?? '';
            if (empty($url)) continue;

            try {
                // Scrape page via Eden AI Scraper
                $scraped = $edenAi->scrapeUrl($apiKey, $url);
                $md = $scraped['markdown'] ?? '';
                if (strlen($md) < 100) continue;

                // Extract company listings via LLM
                $prompt = "Extrahiere alle gelisteten Unternehmen, Handwerker oder Betriebe aus dem Text. Antworte NUR als JSON-Array: [{\"company_name\": \"...\", \"domain\": \"...\", \"phone\": \"...\", \"city\": \"...\"}]";
                $res = $edenAi->chatCompletion(
                    apiKey: $apiKey,
                    model: 'openai/gpt-4o-mini',
                    systemPrompt: $prompt,
                    userPrompt: substr($md, 0, 8000)
                );

                $raw = trim(preg_replace('/^```(?:json)?\n?/i', '', preg_replace('/\n?```$/i', '', $res['raw'])));
                $companies = json_decode($raw, true) ?? [];

                $batch = [];
                foreach ($companies as $c) {
                    if (empty($c['company_name'])) continue;
                    $batch[] = [
                        'id' => (string) Str::uuid(),
                        'case_id' => $case->id,
                        'row_index' => $existingCount++,
                        'data' => json_encode(array_merge($c, ['Quelle' => 'Katalog Deep Crawl', 'katalog_url' => $url])),
                        'cell_statuses' => json_encode([]),
                        'cell_errors' => json_encode([]),
                        'created_at' => now(),
                        'updated_at' => now(),
                    ];
                }

                if (!empty($batch)) {
                    Row::insert($batch);
                    $totalAdded += count($batch);
                }
            } catch (\Throwable $e) {
                // Next catalog
                continue;
            }
        }

        return response()->json([
            'success' => true,
            'message' => "{$totalAdded} neue Leads aus {$catalogs->count()} Katalogen extrahiert.",
            'added' => $totalAdded,
        ]);
    }
}

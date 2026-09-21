<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\GlobalSetting;
use App\Models\Row;
use App\Services\EdenAiService;
use App\Services\MapsService;
use App\Services\SearchService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CrawlStepTestController extends Controller
{
    /**
     * Test a single crawl or search step live and return the extracted context.
     * POST /api/run/test-step
     */
    public function testStep(
        Request $request,
        SearchService $searchService,
        MapsService $mapsService,
        EdenAiService $edenAi
    ): JsonResponse {
        $validated = $request->validate([
            'query' => 'required|string',
            'mode' => 'required|string|in:search,scrape_url,maps',
            'depth' => 'required|string|in:snippet,page',
            'maxResults' => 'nullable|integer|min:1|max:10',
            'rowId' => 'nullable|string',
            'sampleData' => 'nullable|array',
        ]);

        $queryTemplate = $validated['query'];
        $mode = $validated['mode'];
        $depth = $validated['depth'];
        $maxResults = $validated['maxResults'] ?? 3;

        // Resolve row context values
        $rowData = $validated['sampleData'] ?? [];
        if (!empty($validated['rowId'])) {
            $row = Row::find($validated['rowId']);
            if ($row && !empty($row->data)) {
                $rowData = array_merge($row->data, $rowData);
            }
        }

        // Render template with row data fallbacks
        $comp = $rowData['company_name'] ?? $rowData['Unternehmen'] ?? $rowData['name'] ?? 'Beispiel Firma';
        $city = $rowData['city'] ?? $rowData['Stadt'] ?? '';
        $domain = $rowData['domain'] ?? $rowData['website'] ?? '';

        $rendered = str_replace('{company_name}', $comp, $queryTemplate);
        $rendered = str_replace('{city}', $city, $rendered);
        $rendered = str_replace('{domain}', $domain, $rendered);
        foreach ($rowData as $k => $v) {
            if (is_scalar($v)) {
                $rendered = str_replace('{' . $k . '}', (string) $v, $rendered);
            }
        }
        $rendered = trim($rendered);

        $start = microtime(true);
        $output = [];
        $scrapedContent = null;

        try {
            if ($mode === 'maps') {
                $places = $mapsService->search($rendered, limit: $maxResults);
                $output = array_map(fn($p) => [
                    'title' => $p['name'] ?? '',
                    'url' => $p['mapsUrl'] ?? '',
                    'snippet' => implode(' · ', array_filter([
                        $p['address'] ?? null,
                        $p['phone'] ?? null,
                        $p['rating'] ? "{$p['rating']} ★" : null,
                        $p['category'] ?? null,
                    ])),
                ], $places);
            } elseif ($mode === 'scrape_url') {
                $url = str_starts_with($rendered, 'http') ? $rendered : "https://{$rendered}";
                $global = GlobalSetting::instance();
                $apiKey = $global->eden_api_key ?: env('EDEN_API_KEY');
                if ($apiKey) {
                    $scraped = $edenAi->scrapeUrl($apiKey, $url);
                    $scrapedContent = substr($scraped['markdown'] ?? '', 0, 4000);
                    $output = [[
                        'title' => $scraped['title'] ?? $url,
                        'url' => $url,
                        'snippet' => substr(strip_tags($scrapedContent), 0, 250) . '...',
                    ]];
                } else {
                    $output = [['title' => $url, 'url' => $url, 'snippet' => 'Kein Scrape-API-Key konfiguriert']];
                }
            } else {
                // Web search
                $res = $searchService->search($rendered, $maxResults);
                $output = $res['results'] ?? [];

                if ($depth === 'page' && !empty($output[0]['url'])) {
                    $firstUrl = $output[0]['url'];
                    $global = GlobalSetting::instance();
                    $apiKey = $global->eden_api_key ?: env('EDEN_API_KEY');
                    if ($apiKey && !$searchService->isCatalogDomain($firstUrl)) {
                        $scraped = $edenAi->scrapeUrl($apiKey, $firstUrl);
                        $scrapedContent = substr($scraped['markdown'] ?? '', 0, 4000);
                    }
                }
            }

            return response()->json([
                'ok' => true,
                'renderedQuery' => $rendered,
                'latencyMs' => round((microtime(true) - $start) * 1000),
                'resultsCount' => count($output),
                'results' => $output,
                'pageMarkdownSample' => $scrapedContent,
            ]);
        } catch (\Throwable $e) {
            return response()->json([
                'ok' => false,
                'renderedQuery' => $rendered,
                'error' => $e->getMessage(),
            ], 500);
        }
    }
}

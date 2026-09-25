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
                $markdown = '';
                $pageTitle = $url;

                if ($apiKey) {
                    try {
                        $scraped = $edenAi->scrapeUrl($apiKey, $url);
                        $markdown = trim($scraped['markdown'] ?? '');
                        $pageTitle = trim($scraped['title'] ?? '') ?: $url;
                    } catch (\Throwable $e) {
                        // Firecrawl / Eden AI failed — will use direct fallback
                    }
                }

                // Direct HTTP Fallback if Eden AI / Firecrawl failed or returned empty
                if (empty($markdown) || strlen($markdown) < 50) {
                    try {
                        $res = \Illuminate\Support\Facades\Http::timeout(12)
                            ->withHeaders([
                                'User-Agent' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                                'Accept' => 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                            ])
                            ->get($url);

                        if ($res->successful()) {
                            $html = $res->body();
                            // Extract title
                            if (preg_match('/<title[^>]*>(.*?)<\/title>/is', $html, $m)) {
                                $pageTitle = html_entity_decode(trim($m[1]), ENT_QUOTES, 'UTF-8');
                            }
                            // Strip scripts, styles and tags
                            $cleanHtml = preg_replace('/<(script|style|svg|noscript|header|footer|nav)[^>]*>.*?<\/\1>/is', '', $html);
                            // Also remove inline JS blocks or unescaped JS
                            $cleanHtml = preg_replace('/(var\s+[a-zA-Z0-9_$]+\s*=.*?;|function\s*\(.*?\)\s*\{.*?\})/is', '', $cleanHtml);
                            $cleanText = html_entity_decode(strip_tags($cleanHtml), ENT_QUOTES, 'UTF-8');
                            $lines = array_filter(array_map('trim', explode("\n", $cleanText)));
                            $filteredLines = array_filter($lines, fn($l) => strlen($l) > 3 && !str_contains($l, '{') && !str_contains($l, '}') && !str_contains($l, ';') && !str_contains($l, 'var '));
                            $markdown = implode("\n", array_slice($filteredLines, 0, 100));
                        }
                    } catch (\Throwable $e) {
                        // Fallback failed as well
                    }
                }

                // Clean cookie banners & junk
                $markdown = \App\Services\HtmlCleanerService::cleanMarkdown($markdown);
                $scrapedContent = substr($markdown, 0, 4000);

                $snippet = !empty($markdown) 
                    ? substr(preg_replace('/\s+/', ' ', $markdown), 0, 280) . '...' 
                    : 'Kein lesbarer Inhalt extrahiert (Website blockiert oder leer).';

                $output = [[
                    'title' => $pageTitle,
                    'url' => $url,
                    'snippet' => $snippet,
                ]];
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

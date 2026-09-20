<?php

namespace App\Services;

use App\Models\GlobalSetting;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class SearchService
{
    /**
     * Known catalog and directory domains in DACH
     */
    protected array $catalogDomains = [
        'wlw.de', 'gelbeseiten.de', 'dasoertliche.de', 'dastelefonbuch.de',
        '11880.com', '11880.de', 'meinestadt.de', 'stadtbranchenbuch.com',
        'branchenbuch.de', 'firmen.de', 'firmenwissen.de', 'northdata.de',
        'northdata.com', 'companyhouse.de', 'handelsregister.de',
        'unternehmensregister.de', 'bundesanzeiger.de', 'creditreform.de',
        'linkedin.com', 'xing.com', 'facebook.com', 'instagram.com'
    ];

    /**
     * Run web search across configured providers with automatic fallbacks.
     */
    public function search(string $query, int $limit = 10, ?string $preferredSource = 'auto'): array
    {
        $settings = GlobalSetting::instance();
        $start = microtime(true);

        // 1. SerpAPI (if key exists or preferred)
        if (($preferredSource === 'auto' || $preferredSource === 'serpapi') && !empty($settings->serp_api_key)) {
            try {
                $results = $this->searchSerpApi($query, $settings->serp_api_key, $limit);
                if (!empty($results)) {
                    return [
                        'results' => $results,
                        'source' => 'serpapi',
                        'query' => $query,
                        'latency_ms' => round((microtime(true) - $start) * 1000),
                    ];
                }
            } catch (\Throwable $e) {
                Log::warning("SerpAPI search failed: " . $e->getMessage());
            }
        }

        // 2. Serper.dev (if key exists)
        if (($preferredSource === 'auto' || $preferredSource === 'serper') && !empty($settings->serper_api_key)) {
            try {
                $results = $this->searchSerper($query, $settings->serper_api_key, $limit);
                if (!empty($results)) {
                    return [
                        'results' => $results,
                        'source' => 'serper',
                        'query' => $query,
                        'latency_ms' => round((microtime(true) - $start) * 1000),
                    ];
                }
            } catch (\Throwable $e) {
                Log::warning("Serper search failed: " . $e->getMessage());
            }
        }

        // 3. Brave Search (if key exists)
        if (($preferredSource === 'auto' || $preferredSource === 'brave') && !empty($settings->brave_api_key)) {
            try {
                $results = $this->searchBrave($query, $settings->brave_api_key, $limit);
                if (!empty($results)) {
                    return [
                        'results' => $results,
                        'source' => 'brave',
                        'query' => $query,
                        'latency_ms' => round((microtime(true) - $start) * 1000),
                    ];
                }
            } catch (\Throwable $e) {
                Log::warning("Brave search failed: " . $e->getMessage());
            }
        }

        // 4. DuckDuckGo HTML / Instant Answers fallback (free, no key)
        try {
            $results = $this->searchDuckDuckGo($query, $limit);
            return [
                'results' => $results,
                'source' => 'duckduckgo',
                'query' => $query,
                'latency_ms' => round((microtime(true) - $start) * 1000),
            ];
        } catch (\Throwable $e) {
            Log::error("DuckDuckGo search failed: " . $e->getMessage());
        }

        return [
            'results' => [],
            'source' => 'none',
            'query' => $query,
            'latency_ms' => round((microtime(true) - $start) * 1000),
            'error' => 'All search providers failed or no API keys configured.',
        ];
    }

    public function searchSerpApi(string $query, string $apiKey, int $limit): array
    {
        $response = Http::timeout(10)->get('https://serpapi.com/search.json', [
            'q' => $query,
            'api_key' => $apiKey,
            'num' => $limit,
            'engine' => 'google',
            'gl' => 'de',
            'hl' => 'de',
        ]);

        if (!$response->successful()) {
            $msg = $response->json('error') ?: ("SerpAPI HTTP " . $response->status());
            throw new \Exception($msg);
        }

        $organic = $response->json('organic_results') ?? [];
        $out = [];
        foreach (array_slice($organic, 0, $limit) as $item) {
            $out[] = [
                'title' => $item['title'] ?? '',
                'url' => $item['link'] ?? '',
                'snippet' => $item['snippet'] ?? '',
            ];
        }
        return $out;
    }

    public function searchSerper(string $query, string $apiKey, int $limit): array
    {
        $response = Http::timeout(10)
            ->withHeaders(['X-API-KEY' => $apiKey, 'Content-Type' => 'application/json'])
            ->post('https://google.serper.dev/search', [
                'q' => $query,
                'num' => $limit,
                'gl' => 'de',
                'hl' => 'de',
            ]);

        if (!$response->successful()) {
            $msg = $response->json('message') ?: $response->json('error') ?: ("Serper HTTP " . $response->status());
            throw new \Exception($msg);
        }

        $organic = $response->json('organic') ?? [];
        $out = [];
        foreach (array_slice($organic, 0, $limit) as $item) {
            $out[] = [
                'title' => $item['title'] ?? '',
                'url' => $item['link'] ?? '',
                'snippet' => $item['snippet'] ?? '',
            ];
        }
        return $out;
    }

    public function searchBrave(string $query, string $apiKey, int $limit): array
    {
        $response = Http::timeout(10)
            ->withHeaders(['X-Subscription-Token' => $apiKey, 'Accept' => 'application/json'])
            ->get('https://api.search.brave.com/res/v1/web/search', [
                'q' => $query,
                'count' => $limit,
                'country' => 'de',
                'search_lang' => 'de',
            ]);

        if (!$response->successful()) {
            $msg = $response->json('message') ?: $response->json('error') ?: ("Brave HTTP " . $response->status());
            throw new \Exception($msg);
        }

        $results = $response->json('web.results') ?? [];
        $out = [];
        foreach (array_slice($results, 0, $limit) as $item) {
            $out[] = [
                'title' => $item['title'] ?? '',
                'url' => $item['url'] ?? '',
                'snippet' => $item['description'] ?? '',
            ];
        }
        return $out;
    }

    protected function searchDuckDuckGo(string $query, int $limit): array
    {
        // Simple HTML scraping fallback via DuckDuckGo HTML endpoint
        $response = Http::timeout(8)
            ->withUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
            ->asForm()
            ->post('https://html.duckduckgo.com/html/', ['q' => $query]);

        if (!$response->successful()) {
            return [];
        }

        $html = $response->body();
        $out = [];
        
        // Match links and snippets from DDG HTML
        if (preg_match_all('/<a class="result__url" href="([^"]+)".*?<a class="result__snippet[^>]*>(.*?)<\/a>/s', $html, $matches, PREG_SET_ORDER)) {
            foreach (array_slice($matches, 0, $limit) as $m) {
                $url = trim(urldecode($m[1]));
                // Extract actual target from uddg parameter if wrapped
                if (preg_match('/uddg=([^&]+)/', $url, $u)) {
                    $url = urldecode($u[1]);
                }
                $out[] = [
                    'title' => strip_tags($m[0]),
                    'url' => $url,
                    'snippet' => strip_tags($m[2]),
                ];
            }
        }

        return $out;
    }

    public function isCatalogDomain(string $url): bool
    {
        $host = strtolower(parse_url($url, PHP_URL_HOST) ?? '');
        $host = preg_replace('/^www\./', '', $host);

        foreach ($this->catalogDomains as $catalog) {
            if ($host === $catalog || str_ends_with($host, '.' . $catalog)) {
                return true;
            }
        }
        return false;
    }
}

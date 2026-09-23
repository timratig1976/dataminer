<?php

namespace App\Services;

use GuzzleHttp\Client;
use Illuminate\Support\Facades\Log;

class WebsiteNavigationService
{
    protected Client $client;

    public function __construct()
    {
        $this->client = new Client([
            'timeout' => 4,
            'connect_timeout' => 3,
            'http_errors' => false,
            'allow_redirects' => [
                'max' => 5,
                'strict' => false,
                'referer' => true,
                'protocols' => ['http', 'https'],
            ],
            'headers' => [
                'User-Agent' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
                'Accept' => 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language' => 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
            ],
        ]);
    }

    /**
     * Finds the verified Impressum / Legal URL for a given domain by:
     * 1. Inspecting navigation links on the homepage directly (0 API cost, ~200ms)
     * 2. Checking common permuted paths with fast HTTP HEAD requests
     *
     * @param string $domain Domain or URL (e.g. "gasthaus-zur-faehre-burgwall.de")
     * @return string|null Verified live URL or null
     */
    public function findImpressumUrl(string $domain): ?string
    {
        $base = str_starts_with($domain, 'http') ? $domain : "https://{$domain}";
        $base = rtrim($base, '/');

        // 1. Scan Homepage Navigation & Footer Links
        try {
            $response = $this->client->get($base);
            if ($response->getStatusCode() >= 200 && $response->getStatusCode() < 400) {
                $html = (string) $response->getBody();
                $found = $this->extractLinkByPattern($html, $base, [
                    '/impressum/i',
                    '/rechtliches/i',
                    '/legal/i',
                    '/kontakt/i',
                ]);
                if ($found) {
                    return $found;
                }
            }
        } catch (\Throwable $e) {
            Log::debug("[WebsiteNavigationService] Direct homepage fetch failed for {$domain}: " . $e->getMessage());
        }

        // 2. Fast HEAD Pre-Check of Candidate Permutations
        $candidates = [
            "{$base}/impressum",
            "{$base}/Impressum",
            "{$base}/de/impressum",
            "{$base}/rechtliches",
            "{$base}/kontakt",
        ];

        foreach ($candidates as $cand) {
            if ($this->isUrlAccessible($cand)) {
                return $cand;
            }
        }

        return null;
    }

    /**
     * Extract specific link from HTML content using regex patterns.
     */
    public function extractLinkByPattern(string $html, string $baseUrl, array $patterns): ?string
    {
        if (!preg_match_all('/<a\s+[^>]*href=[\x22\x27]([^\x22\x27#]+)[\x22\x27][^>]*>(.*?)<\/a>/is', $html, $matches, PREG_SET_ORDER)) {
            return null;
        }

        foreach ($patterns as $pattern) {
            foreach ($matches as $m) {
                $href = trim($m[1]);
                $text = trim(strip_tags($m[2]));

                if (preg_match($pattern, $href) || preg_match($pattern, $text)) {
                    // Normalize relative to absolute URL
                    if (str_starts_with($href, 'http')) {
                        $targetUrl = $href;
                    } elseif (str_starts_with($href, '//')) {
                        $targetUrl = 'https:' . $href;
                    } elseif (str_starts_with($href, '/')) {
                        $targetUrl = rtrim($baseUrl, '/') . $href;
                    } else {
                        $targetUrl = rtrim($baseUrl, '/') . '/' . $href;
                    }

                    // Verify it is reachable
                    if ($this->isUrlAccessible($targetUrl)) {
                        return $targetUrl;
                    }
                }
            }
        }

        return null;
    }

    /**
     * Fast check whether a URL returns 2xx or 3xx (and not 404/500).
     */
    public function isUrlAccessible(string $url): bool
    {
        try {
            $res = $this->client->head($url);
            $status = $res->getStatusCode();
            return ($status >= 200 && $status < 400);
        } catch (\Throwable $e) {
            return false;
        }
    }
}

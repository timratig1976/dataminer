<?php

namespace App\Services;

use App\Models\DataCase;
use App\Models\Row;
use Illuminate\Support\Str;

class DiscoveryService
{
    protected SearchService $searchService;
    protected MapsService $mapsService;

    public function __construct(SearchService $searchService, MapsService $mapsService)
    {
        $this->searchService = $searchService;
        $this->mapsService = $mapsService;
    }

    /**
     * Executes a web discovery search and filters out duplicates against existing case rows.
     */
    public function discoverWeb(string $caseId, string $query, int $limit = 100): array
    {
        $existingDomains = $this->getExistingDomains($caseId);
        $searchRes = $this->searchService->search($query, $limit);
        $hits = $searchRes['results'] ?? [];

        $newRows = [];
        $consecutiveJunkCount = 0;

        foreach ($hits as $hit) {
            $url = $hit['url'] ?? '';
            $domain = $this->extractDomain($url);

            // Check if result is unwanted (catalog, wikipedia, ebay, social media etc.)
            $isJunk = empty($domain) || $this->searchService->isCatalogDomain($url);

            if ($isJunk) {
                $consecutiveJunkCount++;
                // Early-Exit: If 4 unwanted results appear consecutively, relevance has decayed -> abort this query
                if ($consecutiveJunkCount >= 4) {
                    \Illuminate\Support\Facades\Log::info("[DiscoveryService] Aborting query '{$query}' early after 4 consecutive non-target/catalog results.");
                    break;
                }
                continue;
            }

            // Valid target domain found: reset consecutive junk counter
            $consecutiveJunkCount = 0;

            if (in_array($domain, $existingDomains)) {
                continue;
            }

            $newRows[] = [
                'company_name' => $hit['title'] ?? $domain,
                'domain' => $domain,
                'source_url' => $url,
                'source_title' => $hit['title'] ?? $domain,
                'source_snippet' => $hit['snippet'] ?? null,
                'source_domain' => $domain,
                'search_query' => $query,
                'search_source' => 'google_search',
                'is_catalog' => '',
            ];
            $existingDomains[] = $domain; // prevent duplicate within same run
        }

        return $this->appendRowsToCase($caseId, $newRows);
    }

    /**
     * Executes a Google Maps discovery search and filters out duplicates.
     */
    public function discoverMaps(string $caseId, string $query, ?string $location = null, int $limit = 100): array
    {
        $existingDomains = $this->getExistingDomains($caseId);
        $places = $this->mapsService->search($query, $location, $limit);

        // Fallback to Google Search if Maps yielded 0 results
        if (empty($places)) {
            $fallbackQuery = $location ? "{$query} in {$location}" : $query;
            return $this->discoverWeb($caseId, $fallbackQuery, $limit);
        }

        $newRows = [];
        foreach ($places as $p) {
            $url = $p['website'] ?? '';
            $domain = !empty($url) ? $this->extractDomain($url) : null;

            // Check for social links
            $isFacebook = !empty($url) && (str_contains($url, 'facebook.com') || str_contains($url, 'fb.me') || str_contains($url, 'fb.watch'));
            $isInstagram = !empty($url) && (str_contains($url, 'instagram.com') || str_contains($url, 'instagr.am'));

            // Check if domain is a known catalog or directory (e.g. speisekarte.menu, tripadvisor, facebook)
            $isCatalog = !empty($domain) && $this->searchService->isCatalogDomain($url);

            // Skip duplicates if real domain exists and is not empty
            if (!empty($domain) && !$isCatalog && !$isFacebook && !$isInstagram && in_array($domain, $existingDomains)) {
                continue;
            }

            $name = $p['name'] ?? 'Unbekannt';
            $address = $p['address'] ?? '';
            $mapsUrl = $p['mapsUrl'] ?? '';

            // Parse ZIP and City from address if present (e.g. "Tolstoistraße 12, 17491 Greifswald")
            $zip = '';
            $city = '';
            if (!empty($address) && preg_match('/\b(\d{5})\s+([A-Za-zäöüÄÖÜß\-\.\s]+?)(?:,|$)/u', $address, $m)) {
                $zip = $m[1];
                $city = trim($m[2]);
            }

            // Wenn es eine Portal- oder Social-Domain ist: Hauptdomain leeren & gezielt speichern
            $effectiveDomain = ($isCatalog || $isFacebook || $isInstagram) ? '' : ($domain ?? '');

            $newRows[] = [
                'company_name' => $name,
                'domain' => $effectiveDomain,
                'facebook_url' => $isFacebook ? $url : '',
                'instagram_url' => $isInstagram ? $url : '',
                'raw_portal_domain' => ($isCatalog && !$isFacebook && !$isInstagram) ? ($domain ?? '') : '',
                'address' => $address,
                'zip' => $zip,
                'city' => $city,
                'phone' => $p['phone'] ?? '',
                'industry' => $p['category'] ?? '',
                'category' => $p['category'] ?? '',
                'maps_rating' => !empty($p['rating']) ? (string) $p['rating'] : '',
                'maps_reviews' => !empty($p['reviews']) ? (string) $p['reviews'] : '',
                'maps_url' => $mapsUrl,
                'source_url' => !empty($url) ? $url : $mapsUrl,
                'source_title' => $name,
                'source_snippet' => implode(' · ', array_filter([$p['category'] ?? null, $address])),
                'source_domain' => $domain ?? '',
                'search_query' => $query,
                'search_source' => 'google_maps',
                'is_catalog' => '',
            ];

            if (!empty($effectiveDomain)) {
                $existingDomains[] = $effectiveDomain;
            }
        }

        return $this->appendRowsToCase($caseId, $newRows);
    }

    protected function appendRowsToCase(string $caseId, array $rowsData): array
    {
        if (empty($rowsData)) {
            return ['added_count' => 0];
        }

        $totalExisting = Row::where('case_id', $caseId)->count();
        $batch = [];

        foreach ($rowsData as $idx => $data) {
            $batch[] = [
                'id' => (string) Str::uuid(),
                'case_id' => $caseId,
                'row_index' => $totalExisting + $idx,
                'data' => json_encode($data),
                'cell_statuses' => json_encode([]),
                'cell_errors' => json_encode([]),
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }

        Row::insert($batch);

        // Auto-Trigger Relevance Classification asynchronously or immediate small batch
        try {
            $insertedIds = array_column($batch, 'id');
            app(RelevanceClassificationService::class)->classifyCaseRows($caseId, $insertedIds);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("[DiscoveryService] Auto-classification skipped: " . $e->getMessage());
        }

        return [
            'added_count' => count($batch),
            'total_rows' => $totalExisting + count($batch),
        ];
    }

    protected function getExistingDomains(string $caseId): array
    {
        // Nur die JSON-domain-Spalten via PostgreSQL-Operator extrahieren – kein volles Row-Objekt laden
        $domains = \Illuminate\Support\Facades\DB::table('rows')
            ->where('case_id', $caseId)
            ->selectRaw("
                COALESCE(
                    data->>'Website',
                    data->>'website',
                    data->>'Domain',
                    data->>'domain'
                ) as site
            ")
            ->whereRaw("COALESCE(data->>'Website', data->>'website', data->>'Domain', data->>'domain') IS NOT NULL")
            ->pluck('site')
            ->map(fn($s) => $this->extractDomain($s))
            ->filter()
            ->unique()
            ->values()
            ->toArray();

        return $domains;
    }

    protected function extractDomain(string $url): ?string
    {
        $host = parse_url($url, PHP_URL_HOST) ?? $url;
        $host = strtolower(trim($host));
        $host = preg_replace('/^www\./', '', $host);
        return !empty($host) ? $host : null;
    }
}

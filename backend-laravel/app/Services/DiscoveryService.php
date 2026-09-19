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
    public function discoverWeb(string $caseId, string $query, int $limit = 20): array
    {
        $existingDomains = $this->getExistingDomains($caseId);
        $searchRes = $this->searchService->search($query, $limit);
        $hits = $searchRes['results'] ?? [];

        $newRows = [];
        foreach ($hits as $hit) {
            $url = $hit['url'] ?? '';
            $domain = $this->extractDomain($url);

            if (empty($domain) || in_array($domain, $existingDomains) || $this->searchService->isCatalogDomain($url)) {
                continue;
            }

            $newRows[] = [
                'Unternehmen' => $hit['title'] ?? $domain,
                'Website' => "https://{$domain}",
                'Quelle' => 'Google Search',
                'Suchbegriff' => $query,
                'Snippet' => $hit['snippet'] ?? null,
            ];
            $existingDomains[] = $domain; // prevent duplicate within same run
        }

        return $this->appendRowsToCase($caseId, $newRows);
    }

    /**
     * Executes a Google Maps discovery search and filters out duplicates.
     */
    public function discoverMaps(string $caseId, string $query, ?string $location = null, int $limit = 20): array
    {
        $existingDomains = $this->getExistingDomains($caseId);
        $places = $this->mapsService->search($query, $location, $limit);

        $newRows = [];
        foreach ($places as $p) {
            $url = $p['website'] ?? '';
            $domain = $this->extractDomain($url);

            // Skip duplicates if domain exists
            if (!empty($domain) && in_array($domain, $existingDomains)) {
                continue;
            }

            $newRows[] = [
                'Unternehmen' => $p['name'] ?? 'Unbekannt',
                'Website' => !empty($domain) ? "https://{$domain}" : null,
                'Adresse' => $p['address'] ?? null,
                'Telefon' => $p['phone'] ?? null,
                'Kategorie' => $p['category'] ?? null,
                'Bewertung' => $p['rating'] ?? null,
                'Quelle' => 'Google Maps',
            ];

            if (!empty($domain)) {
                $existingDomains[] = $domain;
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

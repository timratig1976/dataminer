<?php

namespace App\Services;

use App\Models\ScrapeCache;
use App\Models\GlobalSetting;
use Exception;

class BatchEnrichService
{
    public function __construct(
        protected EdenAiService $edenAi,
        protected SearchService $searchService,
        protected MapsService $mapsService
    ) {}

    /**
     * Cache-First Batch Enrichment for a single company row
     *
     * @param array $rowData Existing row data
     * @param string $apiKey EdenAI API Key
     * @param array $requestedFields Target fields to enrich
     * @param string $model LLM model to use
     * @param string|null $customSystemPrompt
     * @param string $region
     * @param array $crawlSources Configured crawl sources (e.g. ['domain', 'maps_details'])
     */
    public function enrichRow(
        array $rowData,
        string $apiKey,
        array $requestedFields,
        string $model = 'openai/gpt-4o-mini',
        ?string $customSystemPrompt = null,
        string $region = 'us',
        array $crawlSources = []
    ): array
    {
        $domain = $this->resolveDomain($rowData);
        $companyName = $rowData['company_name'] ?? $rowData['source_title'] ?? $rowData['name'] ?? $rowData['Unternehmen'] ?? '';
        $existingAddress = $rowData['address'] ?? $rowData['Adresse'] ?? '';
        $existingCity = $rowData['city'] ?? $rowData['Stadt'] ?? '';
        $existingPhone = $rowData['phone'] ?? $rowData['Telefon'] ?? '';
        $existingZip = $rowData['zip'] ?? $rowData['PLZ'] ?? '';
        $existingCategory = $rowData['category'] ?? $rowData['Kategorie'] ?? '';
        $hasExistingGmb = !empty($rowData['maps_url']) || !empty($rowData['maps_rating']) || ($rowData['Quelle'] ?? '') === 'Google Maps';

        // Check if external web crawling / searching is enabled for this column
        $allowWebCrawl = in_array('domain', $crawlSources);
        $allowMapsCrawl = in_array('maps_details', $crawlSources);

        if (!$domain && !$companyName) {
            return ['fields' => [], 'error' => 'No domain or company name available'];
        }

        $contextParts = [];
        $sourceOrigin = $hasExistingGmb ? 'gmb:existing' : 'row:existing';
        $rawMarkdown = '';

        // 1. Existing Row / GMB Context (always used without extra external queries)
        $existingContext = [
            "Name: {$companyName}",
            $existingAddress ? "Adresse: {$existingAddress}" : null,
            $existingCity ? "Stadt: {$existingCity}" : null,
            $existingZip ? "PLZ: {$existingZip}" : null,
            $existingPhone ? "Telefon: {$existingPhone}" : null,
            $domain ? "Website/Domain: {$domain}" : null,
            $existingCategory ? "Kategorie/Branche: {$existingCategory}" : null,
            !empty($rowData['maps_rating']) ? "Maps-Bewertung: {$rowData['maps_rating']}" : null,
        ];
        $contextParts[] = "## Bereits vorhandene Basisdaten (Quelle: " . ($hasExistingGmb ? "Google Maps Import" : "Tabelle") . "):\n" . implode("\n", array_filter($existingContext));

        // 2. GMB Lookup: ONLY if allowMapsCrawl is enabled OR if critical data is missing and domain is completely unknown
        if ($allowMapsCrawl || (!$domain && empty($existingPhone) && empty($existingAddress) && $companyName)) {
            try {
                $mapsQuery = trim("{$companyName} {$existingAddress} {$existingCity}");
                $mapsPlaces = $this->mapsService->search($mapsQuery, limit: 1);
                if (!empty($mapsPlaces)) {
                    $gmb = $mapsPlaces[0];
                    if (!empty($gmb['website'])) {
                        $gmbHost = parse_url($gmb['website'], PHP_URL_HOST);
                        $cleanGmbHost = strtolower(preg_replace('/^www\./', '', $gmbHost ?? ''));
                        if ($cleanGmbHost) {
                            $domain = $cleanGmbHost;
                            $sourceOrigin = 'gmb:maps';
                        }
                    }
                    if (empty($existingPhone) && !empty($gmb['phone'])) {
                        $existingPhone = $gmb['phone'];
                    }
                    if (empty($existingAddress) && !empty($gmb['address'])) {
                        $existingAddress = $gmb['address'];
                    }
                    $contextParts[] = "## Google My Business Live-Lookup:\n" .
                        "- Name: " . ($gmb['name'] ?? $companyName) . "\n" .
                        "- Adresse: " . ($gmb['address'] ?? '') . "\n" .
                        "- Telefon: " . ($gmb['phone'] ?? '') . "\n" .
                        "- Website: " . ($gmb['website'] ?? '') . "\n" .
                        "- Bewertung: " . ($gmb['rating'] ?? '') . " (" . ($gmb['reviews'] ?? 0) . " Bewertungen)\n" .
                        "- Kategorie: " . ($gmb['category'] ?? '');
                }
            } catch (\Throwable $e) {
                // Ignore GMB lookup failure
            }
        }

        // 3. Web Search Fallback: ONLY if allowWebCrawl is true and domain is still missing
        if ($allowWebCrawl && !$domain && $companyName) {
            $searchQuery = trim("{$companyName} {$existingAddress} {$existingCity} Website Impressum");
            $searchRes = $this->searchService->search($searchQuery, 4);
            $results = $searchRes['results'] ?? [];

            foreach ($results as $r) {
                $u = $r['url'] ?? '';
                if ($this->searchService->isCatalogDomain($u)) continue;
                $host = parse_url($u, PHP_URL_HOST);
                $host = strtolower(preg_replace('/^www\./', '', $host ?? ''));
                if ($host && !in_array($host, ['google.com', 'google.de', 'maps.google.com', 'facebook.com', 'instagram.com'])) {
                    $domain = $host;
                    break;
                }
            }

            if (!empty($results)) {
                $snippets = [];
                foreach ($results as $idx => $r) {
                    $snippets[] = "[" . ($idx + 1) . "] " . ($r['title'] ?? '') . "\n" . ($r['snippet'] ?? '');
                }
                $contextParts[] = "## Suchergebnisse:\n" . implode("\n\n", $snippets);
                $sourceOrigin = 'live:search';
            }
        }

        // 4. Scrape website: ONLY if allowWebCrawl is explicitly active (or if missing and domain was provided)
        // If row already has GMB data and web crawl is not activated, do not scrape the website!
        if ($domain && $allowWebCrawl) {
            $base = str_starts_with($domain, 'http') ? $domain : "https://{$domain}";
            $cached = ScrapeCache::isFresh($base);
            if ($cached && strlen($cached->markdown) > 100) {
                $rawMarkdown = $cached->markdown;
                $sourceOrigin = 'cache:db';
            } else {
                try {
                    $scraped = $this->edenAi->scrapeUrl($apiKey, $base);
                    if (!empty($scraped['markdown'])) {
                        $rawMarkdown = $scraped['markdown'];
                        $sourceOrigin = 'live:scrape';

                        ScrapeCache::updateOrCreate(
                            ['url' => $base],
                            [
                                'markdown' => $rawMarkdown,
                                'title' => $scraped['title'] ?? null,
                                'fetched_at' => now(),
                            ]
                        );
                    }
                } catch (Exception $e) {
                    // Scrape failed
                }
            }

            if ($rawMarkdown) {
                $cleanMarkdown = mb_convert_encoding(substr($rawMarkdown, 0, 7000), 'UTF-8', 'UTF-8');
                $contextParts[] = "## Website Content ({$domain}):\n" . $cleanMarkdown;
            }
        }

        // 3. Build Structured LLM Extraction Prompt
        $systemPrompt = !empty($customSystemPrompt) ? $customSystemPrompt : $this->buildSystemPrompt($requestedFields);
        $userPrompt = "Unternehmen: {$companyName}\n";
        if ($existingAddress) $userPrompt .= "Vorhandene Adresse: {$existingAddress}\n";
        if ($existingCity) $userPrompt .= "Vorhandene Stadt: {$existingCity}\n";
        if ($domain) $userPrompt .= "Domain: {$domain}\n";
        $userPrompt .= "\n" . implode("\n\n", $contextParts);

        // Ensure userPrompt is 100% valid UTF-8
        $userPrompt = mb_convert_encoding($userPrompt, 'UTF-8', 'UTF-8');

        // 4. LLM Synthesis
        $chat = $this->edenAi->chatCompletion($apiKey, $model, $systemPrompt, $userPrompt, 800, 0.0, $region);
        $jsonStr = trim(preg_replace('/^```(?:json)?\n?/i', '', preg_replace('/\n?```$/i', '', $chat['raw'])));

        $extracted = json_decode($jsonStr, true) ?? [];
        $fields = [];
        foreach ($requestedFields as $field) {
            $val = $extracted[$field] ?? null;
            $fields[$field] = ($val === null || $val === 'null' || $val === '') ? null : (string) $val;
        }

        // Keep original GMB data if LLM returned null, and support German aliases
        if (empty($fields['address'])) {
            $fields['address'] = $rowData['address'] ?? $rowData['Adresse'] ?? null;
        }
        if (empty($fields['phone'])) {
            $fields['phone'] = $rowData['phone'] ?? $rowData['Telefon'] ?? null;
        }
        if (empty($fields['company_name'])) {
            $fields['company_name'] = $rowData['company_name'] ?? $rowData['Unternehmen'] ?? null;
        }
        if (empty($fields['domain']) && $domain) {
            $fields['domain'] = $domain;
        }
        if (empty($fields['zip']) && !empty($rowData['PLZ'])) {
            $fields['zip'] = $rowData['PLZ'];
        }
        if (empty($fields['city']) && !empty($rowData['Stadt'])) {
            $fields['city'] = $rowData['Stadt'];
        }
        if (empty($fields['industry']) && !empty($rowData['Kategorie'])) {
            $fields['industry'] = $rowData['Kategorie'];
        }

        // Auto-extract ZIP and City if address contains German postal code pattern e.g. "Straße 12, 17489 Greifswald"
        if ((empty($fields['zip']) || empty($fields['city'])) && !empty($fields['address'])) {
            if (preg_match('/\b(\d{5})\s+([A-Za-zäöüÄÖÜß\-\.\s]+?)(?:,|$)/u', $fields['address'], $m)) {
                if (empty($fields['zip'])) $fields['zip'] = $m[1];
                if (empty($fields['city'])) $fields['city'] = trim($m[2]);
            }
        }

        return [
            'fields' => array_filter($fields, fn($v) => $v !== null),
            'source_origin' => $sourceOrigin,
            'tokens' => $chat['tokens']['total'] ?? 0,
            'cost_usd' => $chat['cost_usd'] ?? 0.0004,
            'scrape_markdown' => $rawMarkdown,
            '_scrape_cached_ts' => now()->toIso8601String(),
        ];
    }

    protected function resolveDomain(array $data): string
    {
        foreach (['domain', 'source_domain', 'source_url', 'website', 'Website'] as $k) {
            $val = $data[$k] ?? null;
            if (!$val) continue;
            if (str_contains($val, 'google.com/maps') || str_contains($val, 'place_id')) continue;
            $clean = preg_replace('#^https?://#', '', preg_replace('#^www\.#', '', explode('/', $val)[0]));
            if (str_contains($clean, '.')) return strtolower($clean);
        }
        return '';
    }

    protected function buildSystemPrompt(array $fields): string
    {
        $schema = [];
        foreach ($fields as $f) {
            $schema[$f] = "{$f} value or null";
        }
        $jsonExample = json_encode($schema, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);

        return "Du bist ein präziser Daten-Extraktions-Agent für Unternehmensprofile.\n"
            . "Analysiere den Inhalt und extrahiere die gewünschten Felder.\n"
            . "WICHTIG: Wenn eine Adresse oder Telefonnummer im Input vorhanden ist, behalte sie bei, außer die Website korrigiert sie eindeutig.\n"
            . "Antworte NUR mit validem JSON:\n{$jsonExample}";
    }
}

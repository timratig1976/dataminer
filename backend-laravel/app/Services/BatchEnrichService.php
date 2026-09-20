<?php

namespace App\Services;

use App\Models\ScrapeCache;
use App\Models\GlobalSetting;
use Exception;

class BatchEnrichService
{
    public function __construct(
        protected EdenAiService $edenAi,
        protected SearchService $searchService
    ) {}

    /**
     * Cache-First Batch Enrichment for a single company row
     */
    public function enrichRow(
        array $rowData,
        string $apiKey,
        array $requestedFields,
        string $model = 'openai/gpt-4o-mini',
        ?string $customSystemPrompt = null,
        string $region = 'us'
    ): array
    {
        $domain = $this->resolveDomain($rowData);
        $companyName = $rowData['company_name'] ?? $rowData['source_title'] ?? $rowData['name'] ?? '';
        $existingAddress = $rowData['address'] ?? '';
        $existingCity = $rowData['city'] ?? '';

        if (!$domain && !$companyName) {
            return ['fields' => [], 'error' => 'No domain or company name available'];
        }

        $contextParts = [];
        $sourceOrigin = '';
        $rawMarkdown = '';

        // 1. If domain is missing, search web for company website
        if (!$domain && $companyName) {
            $searchQuery = trim("{$companyName} {$existingAddress} {$existingCity} Website Impressum");
            $searchRes = $this->searchService->search($searchQuery, 4);
            $results = $searchRes['results'] ?? [];

            foreach ($results as $r) {
                $u = $r['url'] ?? '';
                if ($this->searchService->isCatalogDomain($u)) continue;
                $host = parse_url($u, PHP_URL_HOST);
                $host = strtolower(preg_replace('/^www\./', '', $host ?? ''));
                if ($host && !in_array($host, ['google.com', 'google.de', 'maps.google.com', 'facebook.com', 'instagram.com', 'tripadvisor.de'])) {
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

        // 2. Scrape website if domain available
        if ($domain) {
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
                $contextParts[] = "## Website Content ({$domain}):\n" . substr($rawMarkdown, 0, 7000);
            }
        }

        // 3. Build Structured LLM Extraction Prompt
        $systemPrompt = !empty($customSystemPrompt) ? $customSystemPrompt : $this->buildSystemPrompt($requestedFields);
        $userPrompt = "Unternehmen: {$companyName}\n";
        if ($existingAddress) $userPrompt .= "Vorhandene Adresse: {$existingAddress}\n";
        if ($existingCity) $userPrompt .= "Vorhandene Stadt: {$existingCity}\n";
        if ($domain) $userPrompt .= "Domain: {$domain}\n";
        $userPrompt .= "\n" . implode("\n\n", $contextParts);

        // 4. LLM Synthesis
        $chat = $this->edenAi->chatCompletion($apiKey, $model, $systemPrompt, $userPrompt, 800, 0.0, $region);
        $jsonStr = trim(preg_replace('/^```(?:json)?\n?/i', '', preg_replace('/\n?```$/i', '', $chat['raw'])));

        $extracted = json_decode($jsonStr, true) ?? [];
        $fields = [];
        foreach ($requestedFields as $field) {
            $val = $extracted[$field] ?? null;
            $fields[$field] = ($val === null || $val === 'null' || $val === '') ? null : (string) $val;
        }

        // Keep original GMB data if LLM returned null
        if (empty($fields['address']) && !empty($rowData['address'])) {
            $fields['address'] = $rowData['address'];
        }
        if (empty($fields['phone']) && !empty($rowData['phone'])) {
            $fields['phone'] = $rowData['phone'];
        }
        if (empty($fields['company_name']) && !empty($rowData['company_name'])) {
            $fields['company_name'] = $rowData['company_name'];
        }
        if (empty($fields['domain']) && $domain) {
            $fields['domain'] = $domain;
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

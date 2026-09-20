<?php

namespace App\Services;

use App\Models\ScrapeCache;
use App\Models\GlobalSetting;
use Exception;

class BatchEnrichService
{
    public function __construct(
        protected EdenAiService $edenAi
    ) {}

    /**
     * Cache-First Batch Enrichment for a single company row
     */
    public function enrichRow(array $rowData, string $apiKey, array $requestedFields, string $model = 'openai/gpt-4o-mini'): array
    {
        $domain = $this->resolveDomain($rowData);
        $companyName = $rowData['company_name'] ?? $rowData['source_title'] ?? '';

        if (!$domain && !$companyName) {
            return ['fields' => [], 'error' => 'No domain or company name available'];
        }

        $base = str_starts_with($domain, 'http') ? $domain : "https://{$domain}";
        $rawMarkdown = '';
        $sourceOrigin = '';

        // 1. Check PostgreSQL ScrapeCache (7-day fresh check)
        $cached = ScrapeCache::isFresh($base);
        if ($cached && strlen($cached->markdown) > 100) {
            $rawMarkdown = $cached->markdown;
            $sourceOrigin = 'cache:db';
        } else {
            // Live scrape via Eden AI / Firecrawl and cache immediately
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
                // Scrape failed, continue with basic company context
            }
        }

        // 2. Build Structured LLM Extraction Prompt
        $systemPrompt = $this->buildSystemPrompt($requestedFields);
        $userPrompt = "Unternehmen: {$companyName}\nDomain: {$domain}\n\n";
        if ($rawMarkdown) {
            $userPrompt .= "## Website Content:\n" . substr($rawMarkdown, 0, 7000);
        }

        // 3. LLM Synthesis
        $chat = $this->edenAi->chatCompletion($apiKey, $model, $systemPrompt, $userPrompt);
        $jsonStr = trim(preg_replace('/^```(?:json)?\n?/i', '', preg_replace('/\n?```$/i', '', $chat['raw'])));

        $extracted = json_decode($jsonStr, true) ?? [];
        $fields = [];
        foreach ($requestedFields as $field) {
            $val = $extracted[$field] ?? null;
            $fields[$field] = ($val === null || $val === 'null') ? null : (string) $val;
        }

        if (empty($fields['domain']) && $domain) {
            $fields['domain'] = $domain;
        }

        return [
            'fields' => $fields,
            'source_origin' => $sourceOrigin,
            'tokens' => $chat['tokens']['total'] ?? 0,
            'cost_usd' => $chat['cost_usd'] ?? 0.0004,
            'scrape_markdown' => $rawMarkdown,
            '_scrape_cached_ts' => now()->toIso8601String(),
        ];
    }

    protected function resolveDomain(array $data): string
    {
        foreach (['domain', 'source_domain', 'source_url', 'website'] as $k) {
            $val = $data[$k] ?? null;
            if (!$val) continue;
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
            . "Antworte NUR mit validem JSON:\n{$jsonExample}";
    }
}

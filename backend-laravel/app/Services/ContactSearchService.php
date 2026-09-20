<?php

namespace App\Services;

use App\Models\ScrapeCache;
use App\Models\ContactRow;
use Illuminate\Support\Str;
use Exception;

class ContactSearchService
{
    public function __construct(
        protected EdenAiService $edenAi
    ) {}

    /**
     * Cache-First Entscheider-Extraktion
     */
    public function searchContacts(
        array $rowData,
        string $apiKey,
        int $maxContacts = 3,
        string $model = 'openai/gpt-4o-mini',
        ?string $customSystemPrompt = null,
        string $region = 'us'
    ): array
    {
        $domain = $this->resolveDomain($rowData);
        $companyName = $rowData['company_name'] ?? '';

        if (!$domain && !$companyName) {
            return ['contacts' => [], 'error' => 'No domain or company name'];
        }

        $base = "https://" . preg_replace('#^https?://#', '', preg_replace('#^www\.#', '', $domain));
        $rawText = '';
        $sourceOrigin = '';

        // 1. Check Row-Level Scrapes (from Batch Company)
        if (!empty($rowData['_batch_impressum_md'])) {
            $rawText = $rowData['_batch_impressum_md'];
            $sourceOrigin = 'cache:row_impressum';
        } elseif (!empty($rowData['_batch_scrape_md'])) {
            $rawText = $rowData['_batch_scrape_md'];
            $sourceOrigin = 'cache:row_homepage';
        }

        // 2. Check Database ScrapeCache
        if (!$rawText) {
            $cachedImp = ScrapeCache::isFresh("{$base}/impressum");
            if ($cachedImp && strlen($cachedImp->markdown) > 50) {
                $rawText = $cachedImp->markdown;
                $sourceOrigin = 'cache:db_impressum';
            } else {
                $cachedHome = ScrapeCache::isFresh($base);
                if ($cachedHome && strlen($cachedHome->markdown) > 100) {
                    $rawText = $cachedHome->markdown;
                    $sourceOrigin = 'cache:db_homepage';
                }
            }
        }

        // 3. Fallback: Live scrape AT MOST 1 page (impressum)
        if (!$rawText) {
            try {
                $scraped = $this->edenAi->scrapeUrl($apiKey, "{$base}/impressum");
                if (!empty($scraped['markdown'])) {
                    $rawText = $scraped['markdown'];
                    $sourceOrigin = 'live:scrape_impressum';

                    ScrapeCache::updateOrCreate(
                        ['url' => "{$base}/impressum"],
                        [
                            'markdown' => $rawText,
                            'title' => $scraped['title'] ?? null,
                            'fetched_at' => now(),
                        ]
                    );
                }
            } catch (Exception $e) {
                // Live scrape failed
            }
        }

        $defaultSystem = "Du bist ein Kontaktdaten-Extraktions-Agent. Finde Entscheider (Geschäftsführer, Inhaber, CEO).\n"
            . "Antworte NUR mit JSON: {\"contacts\": [{\"first_name\": \"...\", \"last_name\": \"...\", \"position\": \"...\", \"email\": null, \"phone\": null, \"linkedin\": null}], \"company_email\": null}";
        $system = !empty($customSystemPrompt) ? $customSystemPrompt : $defaultSystem;

        $userPrompt = "Unternehmen: {$companyName}\nDomain: {$domain}\n\n";
        if ($rawText) {
            $userPrompt .= "Quelltext:\n" . substr($rawText, 0, 6000);
        }

        $chat = $this->edenAi->chatCompletion($apiKey, $model, $system, $userPrompt, 800, 0.0, $region);
        $jsonStr = trim(preg_replace('/^```(?:json)?\n?/i', '', preg_replace('/\n?```$/i', '', $chat['raw'])));
        $parsed = json_decode($jsonStr, true) ?? [];

        $contacts = array_slice($parsed['contacts'] ?? [], 0, $maxContacts);

        return [
            'contacts' => $contacts,
            'company_email' => $parsed['company_email'] ?? null,
            'source_origin' => $sourceOrigin,
            'tokens' => $chat['tokens']['total'] ?? 0,
            'cost_usd' => $chat['cost_usd'] ?? 0.0003,
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
}

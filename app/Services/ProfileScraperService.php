<?php

namespace App\Services;

use App\Models\ScrapeCache;
use Illuminate\Support\Facades\Log;

class ProfileScraperService
{
    protected EdenAiService $eden;

    public function __construct(EdenAiService $eden)
    {
        $this->eden = $eden;
    }

    /**
     * Scrapes a company website or Impressum page to extract structured contact info.
     */
    public function scrapeProfile(string $websiteUrl): array
    {
        $parsed = parse_url($websiteUrl);
        $scheme = $parsed['scheme'] ?? 'https';
        $host = $parsed['host'] ?? $websiteUrl;
        $baseUrl = "{$scheme}://{$host}";

        // Try to scrape Impressum first, fallback to root
        $candidates = [
            "{$baseUrl}/impressum",
            "{$baseUrl}/de/impressum",
            "{$baseUrl}/kontakt",
            $baseUrl,
        ];

        $markdown = null;
        $usedUrl = null;

        foreach ($candidates as $url) {
            // Check cache
            $cached = ScrapeCache::where('url', $url)->first();
            if ($cached && !empty($cached->content_markdown)) {
                $markdown = $cached->content_markdown;
                $usedUrl = $url;
                break;
            }

            try {
                $res = $this->eden->scrapeUrl($url);
                if (!empty($res['markdown'])) {
                    $markdown = $res['markdown'];
                    $usedUrl = $url;

                    ScrapeCache::updateOrCreate(
                        ['url' => $url],
                        [
                            'content_markdown' => $markdown,
                            'status_code' => 200,
                            'expires_at' => now()->addDays(7),
                        ]
                    );
                    break;
                }
            } catch (\Throwable $e) {
                // Continue to next candidate
                continue;
            }
        }

        if (empty($markdown)) {
            return ['error' => 'Could not scrape website or impressum'];
        }

        // Use LLM to extract company details from the markdown
        $prompt = "Extract contact details and management info from the following website/impressum markdown.\n"
            . "Respond strictly with valid JSON only, no markdown markers, matching this structure:\n"
            . "{\n"
            . '  "company_name": "string or null",' . "\n"
            . '  "managing_directors": ["string"],' . "\n"
            . '  "email": "string or null",' . "\n"
            . '  "phone": "string or null",' . "\n"
            . '  "address": "string or null",' . "\n"
            . '  "vat_id": "string or null"' . "\n"
            . "}\n\n"
            . "Content:\n" . substr($markdown, 0, 8000);

        try {
            $llmResponse = $this->eden->chatCompletion([
                ['role' => 'system', 'content' => 'You are a precise data extraction assistant.'],
                ['role' => 'user', 'content' => $prompt],
            ], 'openai/gpt-4o-mini', 0.0);

            $cleaned = preg_replace('/^```(?:json)?\s*/i', '', trim($llmResponse));
            $cleaned = preg_replace('/\s*```$/', '', $cleaned);

            $extracted = json_decode($cleaned, true) ?? [];
            $extracted['scraped_url'] = $usedUrl;
            return $extracted;
        } catch (\Throwable $e) {
            Log::error("Profile extraction failed: " . $e->getMessage());
            return ['error' => $e->getMessage()];
        }
    }
}

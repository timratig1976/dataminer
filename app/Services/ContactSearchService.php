<?php

namespace App\Services;

use App\Models\ScrapeCache;
use App\Models\ContactRow;
use Illuminate\Support\Str;
use Exception;

class ContactSearchService
{
    public function __construct(
        protected EdenAiService $edenAi,
        protected SearchService $searchService
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
        string $region = 'us',
        bool $searchLinkedIn = true
    ): array
    {
        $domain = $this->resolveDomain($rowData);
        $companyName = $rowData['company_name'] ?? $rowData['Unternehmen'] ?? '';

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
            if ($cachedImp && strlen($cachedImp->markdown) > 100 && !str_contains($cachedImp->markdown, 'does not exist')) {
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

        // 3. Fallback: Find exact Impressum URL via Navigation Links or Search
        if (!$rawText) {
            try {
                $targetImpressumUrl = null;

                // A. Direct Homepage Link Inspection (Scan Menu & Footer for exact case-sensitive link)
                try {
                    $homeRes = (new \GuzzleHttp\Client(['timeout' => 4, 'http_errors' => false, 'allow_redirects' => true]))->get($base);
                    if ($homeRes->getStatusCode() === 200) {
                        $html = (string) $homeRes->getBody();
                        if (preg_match_all('/<a[^>]+href=[\x22\x27]([^\x22\x27#]+)[\x22\x27][^>]*>(.*?)<\/a>/is', $html, $matches, PREG_SET_ORDER)) {
                            foreach ($matches as $m) {
                                $href = trim($m[1]);
                                $text = strip_tags($m[2]);
                                if (stripos($href, 'impressum') !== false || stripos($text, 'impressum') !== false || stripos($href, 'legal') !== false) {
                                    if (str_starts_with($href, 'http')) {
                                        $targetImpressumUrl = $href;
                                    } elseif (str_starts_with($href, '/')) {
                                        $targetImpressumUrl = rtrim($base, '/') . $href;
                                    } else {
                                        $targetImpressumUrl = rtrim($base, '/') . '/' . $href;
                                    }
                                    break;
                                }
                            }
                        }
                    }
                } catch (\Throwable $e) {}

                // B. If not found in menu, try common permutations with fast HEAD pre-check
                if (!$targetImpressumUrl) {
                    $candidates = ["{$base}/impressum", "{$base}/Impressum", "{$base}/de/impressum", "{$base}/kontakt"];
                    foreach ($candidates as $cand) {
                        try {
                            $check = (new \GuzzleHttp\Client(['timeout' => 2.5, 'http_errors' => false, 'allow_redirects' => true]))->head($cand);
                            if ($check->getStatusCode() >= 200 && $check->getStatusCode() < 300) {
                                $targetImpressumUrl = $cand;
                                break;
                            }
                        } catch (\Throwable $e) {}
                    }
                }

                // C. Fallback: Search via Google if still unknown
                if (!$targetImpressumUrl) {
                    $searchRes = $this->searchService->search("{$companyName} {$domain} Impressum", 3);
                    foreach ($searchRes['results'] ?? [] as $sr) {
                        $u = $sr['url'] ?? '';
                        if (str_contains($u, $domain) && (stripos($u, 'impressum') !== false || stripos($u, 'legal') !== false)) {
                            $targetImpressumUrl = $u;
                            break;
                        }
                    }
                }

                // Scrape the verified Impressum URL
                if ($targetImpressumUrl) {
                    $scraped = $this->edenAi->scrapeUrl($apiKey, $targetImpressumUrl);
                    $foundMd = $scraped['markdown'] ?? '';
                    $isFoundGarbage = strlen($foundMd) < 80 
                        || str_contains($foundMd, 'does not exist') 
                        || str_contains($foundMd, '404 Not Found')
                        || str_contains($foundMd, 'Seite nicht gefunden');

                    if (!empty($foundMd) && !$isFoundGarbage) {
                        $rawText = $foundMd;
                        $sourceOrigin = 'live:verified_impressum';
                        ScrapeCache::updateOrCreate(
                            ['url' => $targetImpressumUrl],
                            ['markdown' => $rawText, 'title' => $scraped['title'] ?? null, 'fetched_at' => now()]
                        );
                    }
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

        // 4. Targeted LinkedIn SERP search for discovered names (Fast & bansicher via Google search)
        if ($searchLinkedIn && !empty($contacts) && $companyName) {
            foreach ($contacts as &$contact) {
                if (empty($contact['linkedin'])) {
                    $fullName = trim(($contact['first_name'] ?? '') . ' ' . ($contact['last_name'] ?? ''));
                    // Query mit Namen oder Position + Firma
                    $query = !empty($fullName) 
                        ? "\"{$companyName}\" \"{$fullName}\" site:linkedin.com/in"
                        : "\"{$companyName}\" " . ($contact['position'] ?? 'Geschäftsführer') . " site:linkedin.com/in";

                    try {
                        $searchRes = $this->searchService->search($query, 3);
                        $results = $searchRes['results'] ?? [];
                        foreach ($results as $res) {
                            $u = $res['url'] ?? '';
                            if (str_contains($u, 'linkedin.com/in/')) {
                                $contact['linkedin'] = $u;
                                break;
                            }
                        }
                    } catch (\Throwable $e) {
                        // Ignore linkedin lookup error
                    }
                }
            }
            unset($contact);
        }

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

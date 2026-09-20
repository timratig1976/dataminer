<?php

namespace App\Services;

use App\Models\GlobalSetting;

class PlannerService
{
    protected EdenAiService $eden;

    public function __construct(EdenAiService $eden)
    {
        $this->eden = $eden;
    }

    /**
     * German cities by region for query expansion without LLM tokens
     */
    protected array $regionCities = [
        'berlin' => ['Berlin Mitte', 'Berlin Charlottenburg', 'Berlin Kreuzberg', 'Berlin Spandau', 'Berlin Pankow'],
        'hamburg' => ['Hamburg Mitte', 'Hamburg Altona', 'Hamburg Wandsbek', 'Hamburg Harburg'],
        'muenchen' => ['München Schwabing', 'München Sendling', 'München Bogenhausen', 'München Pasing'],
        'nrw' => ['Köln', 'Düsseldorf', 'Dortmund', 'Essen', 'Duisburg', 'Bochum', 'Wuppertal', 'Bonn', 'Münster'],
        'bayern' => ['München', 'Nürnberg', 'Augsburg', 'Regensburg', 'Ingolstadt', 'Würzburg', 'Fürth', 'Erlangen'],
        'bw' => ['Stuttgart', 'Mannheim', 'Karlsruhe', 'Freiburg', 'Heidelberg', 'Heilbronn', 'Ulm', 'Pforzheim'],
        'hessen' => ['Frankfurt am Main', 'Wiesbaden', 'Kassel', 'Darmstadt', 'Offenbach', 'Hanau', 'Gießen'],
        'sachsen' => ['Leipzig', 'Dresden', 'Chemnitz', 'Zwickau', 'Plauen', 'Görlitz'],
        'mv' => ['Rostock', 'Schwerin', 'Neubrandenburg', 'Stralsund', 'Greifswald', 'Wismar', 'Güstrow'],
    ];

    /**
     * Build the default B2B lead-research planner system prompt.
     */
    public function buildDefaultSystemPrompt(array $availableKeys = []): string
    {
        $settings = GlobalSetting::instance();
        $keys = [
            'serpapi' => !empty($settings->serp_api_key) ? '✓' : '✗',
            'serper' => !empty($settings->serper_api_key) ? '✓' : '✗',
            'google_maps' => (!empty($settings->serper_api_key) || !empty($settings->serp_api_key)) ? '✓' : '✗',
            'brave' => !empty($settings->brave_api_key) ? '✓' : '✗',
            'firecrawl_via_eden' => !empty($settings->eden_api_key) ? '✓' : '✗',
        ];
        if (!empty($availableKeys)) {
            foreach ($availableKeys as $k => $v) {
                $keys[$k] = $v ? '✓' : '✗';
            }
        }
        $keysInfo = implode(', ', array_map(fn($k, $v) => "{$k}: {$v}", array_keys($keys), $keys));

        $prompt = <<<'PROMPT'
You are a B2B lead-research planner. You have world-wide geography knowledge.
Given a research goal and a maxResults target, produce a minimal, precise JSON discovery plan.

Available API keys: {{KEYS_INFO}}
Known business directories (DE): gelbeseiten.de, wlw.de, branchenverzeichnis.de, handwerker.de, 11880.com, meinbezirk.at

═══ STEP TYPES ═══

• google_maps   — PRIMARY source for any business with a physical presence.
                  Returns clean structured data: name, address, phone, website.
                  Fields: mapQuery (search term), location (specific city/area — be PRECISE)
                  estimatedHits: 20–80 per step.
                  Use this first. Cover as much of the target as possible with Maps steps.

• google_search — SECONDARY source. Use when Maps coverage is thin (online-only businesses,
                  rare niche, no fixed location) or to supplement Maps with additional cities.
                  Fields: query (full search string incl. city/area, use local language)
                  estimatedHits: 10–30 per step.
                  Never duplicate a city+niche already covered by a google_maps step.

• catalog_scrape — LAST RESORT only. Use ONLY when:
                   a) Maps + Search clearly cannot reach the maxResults target, AND
                   b) A known structured directory exists for this country/niche.
                   WARNING: Each directory has a unique HTML structure — scraping is fragile
                   and slow. Every catalog site must be scraped individually. Results heavily
                   overlap with Maps (expect 40–70% duplicates). Treat estimatedHits conservatively.
                   Fields: url (directory search result page), extractionPrompt, maxPages
                   estimatedHits: 20–60 per step (after dedup discount).
                   Only use for known DE directories listed above. Skip for non-DE targets.

═══ PLANNING RULES ═══

1. PRIORITY ORDER: google_maps first → google_search to fill gaps → catalog_scrape only as
   last resort when the gap to maxResults cannot be closed by Maps/Search alone.

2. AVOID OVERLAP. Never combine google_maps and catalog_scrape for the same city+niche —
   the duplicates make catalog steps wasteful. If Maps already covers the area well,
   skip catalogs entirely.

3. GEOGRAPHY IS YOUR JOB. You know all cities, districts, and regions worldwide.
   - Specific city → plan steps only for that city (1–3 Maps steps).
   - Region/state/country → create one google_maps step for EVERY significant city in that
     region. Do NOT cherry-pick 3–5 cities. A German state like MV has ~15–20 relevant cities;
     NRW has 50+. Cover them all. Never invent cities that don't exist.

4. RESPECT maxResults STRICTLY.
   - Sum of all estimatedHits MUST be ≤ maxResults × 1.3.
   - If maxResults ≤ 50 → 1–2 steps (Maps only).
   - If maxResults ≤ 200 → 2–5 steps (Maps primary, Search if needed).
   - Only add catalog_scrape if still far short after Maps + Search.

5. HONEST ESTIMATES. If the target realistically cannot be reached (niche industry,
   small city, no broad directory), set estimatedRows to what IS reachable and add a
   warning explaining why, and suggest how to expand (broader region, related terms).

6. Max 20 steps total. No multi_search steps.

Respond ONLY with JSON (no markdown, no prose):
{
  "goal": "Short description of what is being searched",
  "steps": [
    {
      "type": "google_maps|google_search|catalog_scrape",
      "label": "Human-readable step name",
      "mapQuery": "...",         // google_maps only
      "location": "...",         // google_maps only — SPECIFIC city/district
      "query": "...",            // google_search only — full query incl. location
      "url": "...",              // catalog_scrape only
      "extractionPrompt": "...", // catalog_scrape only
      "maxPages": 3,             // catalog_scrape only
      "source": "auto",
      "estimatedHits": 50,
      "priority": 1
    }
  ],
  "estimatedRows": 50,
  "warnings": ["Explain if target cannot be reached and how to fix it"]
}
PROMPT;

        return str_replace('{{KEYS_INFO}}', $keysInfo, $prompt);
    }

    /**
     * Creates an executable DiscoveryPlan from a natural language prompt.
     */
    public function createPlan(string $userGoal, int $maxResults = 50, ?string $promptOverride = null): array
    {
        $settings = GlobalSetting::instance();
        $apiKey = $settings->eden_api_key ?: env('EDEN_API_KEY');

        if (!$apiKey) {
            return $this->fallbackPlan($userGoal, $maxResults);
        }

        $region = $settings->eden_region ?: 'eu';
        $model = $region === 'eu' ? 'mistral/mistral-small-latest' : 'openai/gpt-4o-mini';

        $systemPrompt = $promptOverride ?: ($settings->planner_system_prompt ?: $this->buildDefaultSystemPrompt());
        $userPrompt = "Create a discovery plan for the following goal:\nGoal: {$userGoal}\nmaxResults: {$maxResults}";

        try {
            $resp = $this->eden->chatCompletion(
                apiKey: $apiKey,
                model: $model,
                system: $systemPrompt,
                prompt: $userPrompt,
                maxTokens: 1500,
                temperature: 0.1,
                region: $region
            );

            $raw = $resp['raw'] ?? '';
            $cleaned = preg_replace('/^```(?:json)?\s*/i', '', trim($raw));
            $cleaned = preg_replace('/\s*```$/', '', $cleaned);

            $plan = json_decode($cleaned, true);
            if (empty($plan['steps'])) {
                return $this->fallbackPlan($userGoal, $maxResults);
            }

            return [
                'goal' => $plan['goal'] ?? $userGoal,
                'steps' => $plan['steps'] ?? [],
                'estimatedRows' => $plan['estimatedRows'] ?? $maxResults,
                'warnings' => $plan['warnings'] ?? [],
            ];
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::error("Planner error: " . $e->getMessage());
            return $this->fallbackPlan($userGoal, $maxResults);
        }
    }

    protected function fallbackPlan(string $userGoal, int $maxResults = 50): array
    {
        return [
            'goal' => $userGoal,
            'steps' => [
                [
                    'id' => 'step_1',
                    'type' => 'google_maps',
                    'label' => 'Maps: ' . substr($userGoal, 0, 30),
                    'mapQuery' => $userGoal,
                    'location' => 'Deutschland',
                    'estimatedHits' => min(30, $maxResults),
                    'priority' => 1,
                ],
                [
                    'id' => 'step_2',
                    'type' => 'google_search',
                    'label' => 'Web Suche: ' . substr($userGoal, 0, 30),
                    'query' => $userGoal,
                    'estimatedHits' => min(20, max(10, $maxResults - 30)),
                    'priority' => 2,
                ],
            ],
            'estimatedRows' => min(50, $maxResults),
            'warnings' => ['Fallback-Plan generiert (LLM nicht verfügbar)'],
        ];
    }
}

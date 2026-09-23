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

3. GEOGRAPHY & QUERY FORMULATION (CRUCIAL):
   - CRITICAL: Never use abstract umbrella terms like "Tourismus Gastgewerbe", "Handwerk" or "Dienstleistungen" as mapQuery on Google Maps!
     Google Maps does not have a category named "Tourismus Gastgewerbe". A search for "Tourismus Gastgewerbe Rostock" returns only 2-3 tourism offices or marketing associations!
   - ALWAYS split umbrella terms into concrete sub-categories that Google Maps places actually have:
     e.g. for "Tourismus/Gastgewerbe": "Restaurants", "Hotels", "Ferienwohnungen", "Cafés", "Pensionen", "Gasthäuser".
     e.g. for "Handwerk": "Dachdecker", "Elektriker", "Maler", "Sanitär Heizung", "Tischler".
   - Specific city → plan steps only for that city across multiple concrete sub-categories.
   - Region/state/country → combine the largest cities in that region with concrete business categories (e.g. "Restaurants Rostock", "Hotels Schwerin", "Ferienwohnungen Rügen"). Cover concrete locations. Never invent cities that don't exist.

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
     * Optionally takes a caseId to analyze existing data and prevent redundant searches.
     */
    public function createPlan(
        string $userGoal,
        int $maxResults = 50,
        ?string $promptOverride = null,
        string $sourceMode = 'gmb_first',
        ?string $caseId = null
    ): array
    {
        // ── 0. Deterministic Plan Generation for Explicit Sub-Industry & City Inputs ──
        // If the user selected specific sub-branches and cities in the Sub-Industry modal,
        // we can construct the steps directly, cleanly and instantly without LLM token truncation.
        if (preg_match('/Sub-Branchen:\s*(.+?)\.\s*Städte:\s*(.+?)\./s', $userGoal, $matches)) {
            $rawBranches = $matches[1];
            $rawCities = $matches[2];

            // Parse branches (e.g. "Hotellerie", "Gastronomie", "Restaurant")
            preg_match_all('/"([^"]+)"/', $rawBranches, $bMatches);
            $branches = !empty($bMatches[1]) ? $bMatches[1] : array_map('trim', explode(',', $rawBranches));
            
            // Clean up any trailing region suffix (e.g. "Gastronomie MV" -> "Gastronomie")
            $branches = array_map(function ($b) {
                return trim(preg_replace('/\b(MV|Mecklenburg-Vorpommern|NRW|Bayern|Deutschland)\b/i', '', $b));
            }, array_filter($branches));
            $branches = array_values(array_unique(array_filter($branches)));

            // Parse cities
            $cities = array_values(array_unique(array_filter(array_map('trim', explode(',', $rawCities)))));

            if (!empty($branches) && !empty($cities)) {
                $steps = [];
                $stepIndex = 1;
                $totalEstimated = 0;
                $maxSteps = 2000; // Increased to 2,000 so full combinations (e.g. 20 branches x 70 cities = 1,400) are fully planned

                // Interleave cities and branches: loop cities primarily, or round-robin across branches,
                // so EVERY selected branch is included across all selected cities!
                $branchCount = count($branches);
                $cityCount = count($cities);

                for ($cIdx = 0; $cIdx < $cityCount; $cIdx++) {
                    $city = $cities[$cIdx];
                    for ($bIdx = 0; $bIdx < $branchCount; $bIdx++) {
                        $branch = $branches[$bIdx];

                        $estimatedHits = in_array(strtolower($city), ['rostock', 'schwerin', 'neubrandenburg', 'stralsund', 'greifswald']) ? 25 : 15;
                        $steps[] = [
                            'id' => 'step_' . $stepIndex++,
                            'type' => 'google_maps',
                            'label' => "{$branch} in {$city}",
                            'mapQuery' => $branch,
                            'location' => "{$city}, Mecklenburg-Vorpommern",
                            'source' => 'auto',
                            'estimatedHits' => $estimatedHits,
                            'priority' => 1,
                        ];
                        $totalEstimated += $estimatedHits;

                        if (count($steps) >= $maxSteps) {
                            break 2;
                        }
                    }
                }

                if (!empty($steps)) {
                    return [
                        'goal' => "Gezielte Suche für " . count($branches) . " Branchen in " . count($cities) . " Städten (" . count($steps) . " Schritte)",
                        'steps' => $steps,
                        'estimatedRows' => min($maxResults, $totalEstimated),
                        'warnings' => [],
                    ];
                }
            }
        }

        $settings = GlobalSetting::instance();
        $apiKey = $settings->eden_api_key ?: env('EDEN_API_KEY');

        if (!$apiKey) {
            return $this->fallbackPlan($userGoal, $maxResults);
        }

        $region = $settings->eden_region ?: 'us';
        $model = $region === 'eu' ? 'mistral/mistral-large-latest' : 'openai/gpt-4o';

        $systemPrompt = $promptOverride ?: ($settings->planner_system_prompt ?: $this->buildDefaultSystemPrompt());
        
        $modeInstruction = match($sourceMode) {
            'gmb_only' => "\nSTRATEGY INSTRUCTION: Use ONLY 'google_maps' steps. Do NOT generate any 'google_search' or 'catalog_scrape' steps.",
            'search_only' => "\nSTRATEGY INSTRUCTION: Use ONLY 'google_search' steps. Do NOT generate any 'google_maps' steps.",
            'search_first' => "\nSTRATEGY INSTRUCTION: Prioritize 'google_search' steps first to discover leads from web indices, and only add 'google_maps' as secondary supplement.",
            default => "\nSTRATEGY INSTRUCTION: GMB First: Prioritize 'google_maps' steps for physical presence / local businesses. Add 'google_search' only for supplementary coverage.",
        };

        // If caseId is provided, extract existing profile to avoid duplicate searches
        $caseContextInstruction = "";
        if (!empty($caseId)) {
            $caseContextInstruction = $this->buildCaseContextInstruction($caseId);
        }

        $userPrompt = "Create a discovery plan for the following goal:\nGoal: {$userGoal}\nmaxResults: {$maxResults}" . $modeInstruction . $caseContextInstruction;

        try {
            $resp = $this->eden->chatCompletion(
                apiKey: $apiKey,
                model: $model,
                system: $systemPrompt,
                prompt: $userPrompt,
                maxTokens: 3500,
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

    /**
     * Aggregates existing cities, categories, and company names in this case
     * to prevent the planner from generating redundant searches.
     */
    protected function buildCaseContextInstruction(string $caseId): string
    {
        try {
            $rows = \App\Models\Row::where('case_id', $caseId)->limit(500)->get();
            if ($rows->isEmpty()) {
                return "";
            }

            $cities = [];
            $categories = [];
            $companyNames = [];

            foreach ($rows as $r) {
                $d = $r->data ?? [];
                $c = $d['city'] ?? $d['Stadt'] ?? null;
                if ($c && strlen($c) > 2 && strlen($c) < 50) {
                    $cities[$c] = ($cities[$c] ?? 0) + 1;
                }
                $cat = $d['category'] ?? $d['Kategorie'] ?? $d['industry'] ?? null;
                if ($cat && strlen($cat) > 2 && strlen($cat) < 50) {
                    $categories[$cat] = ($categories[$cat] ?? 0) + 1;
                }
                $name = $d['company_name'] ?? $d['Unternehmen'] ?? null;
                if ($name && strlen($name) < 40) {
                    $companyNames[] = $name;
                }
            }

            arsort($cities);
            arsort($categories);

            $topCities = array_slice(array_keys($cities), 0, 8);
            $topCats = array_slice(array_keys($categories), 0, 6);
            $sampleCompanies = array_slice($companyNames, 0, 10);

            $cityStr = !empty($topCities) ? implode(', ', $topCities) : 'keine';
            $catStr = !empty($topCats) ? implode(', ', $topCats) : 'keine';
            $compStr = !empty($sampleCompanies) ? implode(', ', $sampleCompanies) : 'keine';

            return "\n\nEXISTING CASE DATA CONTEXT (DO NOT DUPLICATE THESE):" .
                "\nThis project already contains " . $rows->count() . " existing leads!" .
                "\n- Heavily covered cities in this case: " . $cityStr .
                "\n- Existing categories in this case: " . $catStr .
                "\n- Sample of existing companies: " . $compStr .
                "\n\nCRITICAL DEDUPLICATION DIRECTIVE:" .
                "\n1. Do NOT generate discovery steps that target the exact same combinations of heavily covered cities and categories." .
                "\n2. Focus on complementary sub-niches, neighboring towns/districts, or broader geographical coverage that is NOT yet covered above." .
                "\n3. Ensure maximum new unique leads yield.";
        } catch (\Throwable $e) {
            return "";
        }
    }
}

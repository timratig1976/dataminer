<?php

namespace App\Services;

class CostTrackerService
{
    /**
     * Standard pricing table per API call / operation across all integrated platforms.
     * Expressed in USD.
     */
    public const API_RATES = [
        // ── Search & Maps Providers ──
        'serper_search'   => ['name' => 'Serper.dev Web-Suche', 'cost_usd' => 0.0010, 'unit' => 'Query'],
        'serper_places'   => ['name' => 'Serper.dev Places / Maps', 'cost_usd' => 0.0010, 'unit' => 'Query'],
        'serpapi_maps'    => ['name' => 'SerpAPI Google Maps', 'cost_usd' => 0.0100, 'unit' => 'Query'],
        'apify_maps'      => ['name' => 'Apify Google Maps Scraper', 'cost_usd' => 0.0040, 'unit' => 'Place'],
        'brave_search'    => ['name' => 'Brave Search API', 'cost_usd' => 0.0030, 'unit' => 'Query'],

        // ── Scraping ──
        'firecrawl_scrape'=> ['name' => 'Firecrawl Web-Scrape', 'cost_usd' => 0.0040, 'unit' => 'Page'],
        'eden_scrape'     => ['name' => 'Eden AI Scrape / Fallback', 'cost_usd' => 0.0035, 'unit' => 'Page'],

        // ── LLM Models (per 1k tokens average input/output) ──
        'gpt-4o-mini'     => ['name' => 'OpenAI GPT-4o-mini (via Eden)', 'cost_per_1k_tokens' => 0.0003],
        'mistral-small'   => ['name' => 'Mistral Small (EU)', 'cost_per_1k_tokens' => 0.0002],
        'gpt-4o'          => ['name' => 'OpenAI GPT-4o', 'cost_per_1k_tokens' => 0.0050],
    ];

    /**
     * Calculate cost for a search or scraper call
     */
    public static function getOperationRate(string $operation): float
    {
        return self::API_RATES[$operation]['cost_usd'] ?? 0.001;
    }
}

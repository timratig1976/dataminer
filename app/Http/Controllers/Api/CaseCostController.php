<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AgentRun;
use App\Models\DataCase;
use App\Models\Row;
use App\Services\CostTrackerService;
use Illuminate\Http\JsonResponse;

class CaseCostController extends Controller
{
    /**
     * Get detailed cost breakdown for a case.
     * GET /api/cases/{id}/costs
     */
    public function show(string $id): JsonResponse
    {
        $case = DataCase::findOrFail($id);
        $runs = AgentRun::where('case_id', $case->id)->get();
        $rows = Row::where('case_id', $case->id)->get();

        $searchCalls = 0;
        $mapsCalls = 0;
        $scrapeCalls = 0;
        $llmCalls = 0;

        $costSearch = 0.0;
        $costMaps = 0.0;
        $costScrape = 0.0;
        $costLlm = 0.0;
        $totalTokens = 0;

        // Breakdown from Agent Runs
        foreach ($runs as $r) {
            $state = $r->state ?? [];
            $stepResults = $state['stepResults'] ?? [];
            foreach ($stepResults as $step) {
                $src = $step['source'] ?? '';
                if ($src === 'google_maps' || str_contains($src, 'maps')) {
                    $mapsCalls++;
                    $costMaps += CostTrackerService::getOperationRate('serper_places');
                } else {
                    $searchCalls++;
                    $costSearch += CostTrackerService::getOperationRate('serper_search');
                }
            }
            $totalTokens += (int) ($state['tokens'] ?? 0);
            // Planner LLM Cost
            $llmCalls += 1;
            $costLlm += 0.0004; // Plan creation cost
        }

        // Breakdown from Row Cell Enrichment (if cached or executed)
        foreach ($rows as $row) {
            $data = $row->data ?? [];
            if (!empty($data['_batch_firmendaten'])) {
                $llmCalls++;
                $costLlm += 0.0004;
                $totalTokens += 800;
            }
            if (!empty($data['_scrape_origin']) && str_starts_with($data['_scrape_origin'], 'live:')) {
                $scrapeCalls++;
                $costScrape += CostTrackerService::getOperationRate('firecrawl_scrape');
            }
        }

        $totalCostUsd = $costSearch + $costMaps + $costScrape + $costLlm;
        $totalCostEur = $totalCostUsd * 0.91; // Standard EUR conversion

        return response()->json([
            'totals' => [
                'totalCostUsd' => round($totalCostUsd, 4),
                'totalCostEur' => round($totalCostEur, 4),
                'totalTokens' => $totalTokens,
                'totalCalls' => $searchCalls + $mapsCalls + $scrapeCalls + $llmCalls,
            ],
            'rates' => CostTrackerService::API_RATES,
            'breakdown' => [
                [
                    'category' => 'Google Maps (Places)',
                    'provider' => 'Serper.dev Places API',
                    'rate' => '$0.0010 pro Query',
                    'calls' => $mapsCalls,
                    'costUsd' => round($costMaps, 4),
                ],
                [
                    'category' => 'Google Web-Suche',
                    'provider' => 'Serper.dev Search API',
                    'rate' => '$0.0010 pro Query',
                    'calls' => $searchCalls,
                    'costUsd' => round($costSearch, 4),
                ],
                [
                    'category' => 'Web Scraping (Impressum & Home)',
                    'provider' => 'Firecrawl / Eden AI Scrape',
                    'rate' => '$0.0040 pro Seite',
                    'calls' => $scrapeCalls,
                    'costUsd' => round($costScrape, 4),
                ],
                [
                    'category' => 'LLM Analyse & Planung',
                    'provider' => 'OpenAI GPT-4o-mini (Eden Gateway)',
                    'rate' => '~$0.0003 pro 1k Tokens',
                    'calls' => $llmCalls,
                    'costUsd' => round($costLlm, 4),
                ],
            ],
        ]);
    }
}

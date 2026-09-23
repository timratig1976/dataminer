<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\GlobalSetting;
use App\Services\SearchService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SearchDebugController extends Controller
{
    /**
     * Run debug queries across all configured search providers and return raw logs.
     * POST /api/search/debug
     */
    public function debug(Request $request, SearchService $searchService): JsonResponse
    {
        $query = $request->input('query', 'Handwerker Berlin');
        $settings = GlobalSetting::instance();
        $logs = [];

        // 1. Serper.dev
        if (!empty($settings->serper_api_key)) {
            $t0 = microtime(true);
            try {
                $res = $searchService->searchSerper($query, $settings->serper_api_key, 3);
                $logs[] = [
                    'provider' => 'serper',
                    'ok' => count($res) > 0,
                    'latencyMs' => round((microtime(true) - $t0) * 1000),
                    'resultsCount' => count($res),
                ];
            } catch (\Throwable $e) {
                $logs[] = ['provider' => 'serper', 'ok' => false, 'error' => $e->getMessage()];
            }
        }

        // 2. SerpApi
        if (!empty($settings->serp_api_key)) {
            $t0 = microtime(true);
            try {
                $res = $searchService->searchSerpApi($query, $settings->serp_api_key, 3);
                $logs[] = [
                    'provider' => 'serpapi',
                    'ok' => count($res) > 0,
                    'latencyMs' => round((microtime(true) - $t0) * 1000),
                    'resultsCount' => count($res),
                ];
            } catch (\Throwable $e) {
                $logs[] = ['provider' => 'serpapi', 'ok' => false, 'error' => $e->getMessage()];
            }
        }

        // 3. Brave
        if (!empty($settings->brave_api_key)) {
            $t0 = microtime(true);
            try {
                $res = $searchService->searchBrave($query, $settings->brave_api_key, 3);
                $logs[] = [
                    'provider' => 'brave',
                    'ok' => count($res) > 0,
                    'latencyMs' => round((microtime(true) - $t0) * 1000),
                    'resultsCount' => count($res),
                ];
            } catch (\Throwable $e) {
                $logs[] = ['provider' => 'brave', 'ok' => false, 'error' => $e->getMessage()];
            }
        }

        return response()->json(['logs' => $logs, 'query' => $query]);
    }
}

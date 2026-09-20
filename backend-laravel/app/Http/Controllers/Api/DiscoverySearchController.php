<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DataCase;
use App\Models\GlobalSetting;
use App\Models\Row;
use App\Services\DiscoveryService;
use App\Services\MapsService;
use App\Services\SearchService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DiscoverySearchController extends Controller
{
    /**
     * Preview discovery search results without inserting rows.
     * GET/POST /api/discovery/search
     */
    public function search(
        Request $request,
        SearchService $searchService,
        MapsService $mapsService
    ): JsonResponse {
        $query = $request->input('query') ?: $request->query('q');
        $source = $request->input('source') ?: $request->query('source', 'auto');
        $limit = min(100, max(1, (int) ($request->input('limit') ?: $request->query('limit', 20))));
        $caseId = $request->input('caseId') ?: $request->query('caseId');

        if (empty(trim((string) $query))) {
            return response()->json(['error' => 'query required'], 400);
        }

        // Get existing domains if caseId provided to mark duplicates
        $existingDomains = [];
        if ($caseId) {
            $existingDomains = Row::where('case_id', $caseId)
                ->whereNotNull('data->domain')
                ->pluck('data->domain')
                ->map(fn($d) => strtolower(trim((string)$d)))
                ->filter()
                ->toArray();
        }

        $results = [];
        if (str_starts_with($source, 'maps')) {
            $places = $mapsService->search($query, 'Deutschland', $limit);
            foreach ($places as $p) {
                $rawUrl = $p['website'] ?? '';
                $cleanDomain = strtolower(trim(preg_replace('/^https?:\/\//', '', $rawUrl)));
                $cleanDomain = preg_replace('/\/.*$/', '', $cleanDomain);
                $cleanDomain = preg_replace('/^www\./', '', $cleanDomain);

                $results[] = [
                    'title' => $p['name'] ?? 'Unbekannt',
                    'url' => $rawUrl,
                    'domain' => $cleanDomain,
                    'address' => $p['address'] ?? null,
                    'phone' => $p['phone'] ?? null,
                    'isDuplicate' => in_array($cleanDomain, $existingDomains),
                ];
            }
        } else {
            $search = $searchService->search($query, $limit, $source);
            foreach ($search['results'] ?? [] as $hit) {
                $rawUrl = $hit['url'] ?? '';
                $cleanDomain = strtolower(trim(preg_replace('/^https?:\/\//', '', $rawUrl)));
                $cleanDomain = preg_replace('/\/.*$/', '', $cleanDomain);
                $cleanDomain = preg_replace('/^www\./', '', $cleanDomain);

                $results[] = [
                    'title' => $hit['title'] ?? $cleanDomain,
                    'url' => $rawUrl,
                    'domain' => $cleanDomain,
                    'snippet' => $hit['snippet'] ?? null,
                    'isDuplicate' => in_array($cleanDomain, $existingDomains),
                ];
            }
        }

        return response()->json([
            'query' => $query,
            'source' => $source,
            'hits' => count($results),
            'results' => $results,
        ]);
    }

    /**
     * Check if necessary API keys are configured for an agent run.
     * GET /api/cases/{id}/agent/check-keys
     */
    public function checkKeys(string $id): JsonResponse
    {
        $case = DataCase::findOrFail($id);
        $settings = GlobalSetting::instance();

        $hasEden = !empty($case->eden_api_key) || !empty($settings->eden_api_key) || !empty(env('EDEN_API_KEY'));
        $hasSearch = !empty($settings->serper_api_key) || !empty($settings->serp_api_key) || !empty($settings->brave_api_key) || !empty(env('SERPER_API_KEY')) || !empty(env('SERP_API_KEY')) || !empty(env('BRAVE_API_KEY'));

        return response()->json([
            'ready' => $hasEden && $hasSearch,
            'hasEdenKey' => $hasEden,
            'hasSearchKey' => $hasSearch,
            'hasMapsKey' => !empty($settings->serper_api_key) || !empty($settings->serp_api_key),
            'hasFirecrawlKey' => !empty($settings->firecrawl_api_key),
        ]);
    }
}

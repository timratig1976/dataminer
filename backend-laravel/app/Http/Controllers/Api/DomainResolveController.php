<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DataCase;
use App\Models\Row;
use App\Services\SearchService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DomainResolveController extends Controller
{
    /**
     * Resolve missing domains for company rows via web search.
     * POST /api/cases/{id}/resolve-domains
     */
    public function resolve(
        Request $request,
        string $id,
        SearchService $searchService
    ): JsonResponse {
        $case = DataCase::findOrFail($id);
        $limit = min((int) $request->input('limit', 50), 100);

        // Find rows without domain
        $targets = Row::where('case_id', $case->id)
            ->where(function ($q) {
                $q->whereNull("data->domain")
                  ->orWhere("data->domain", '');
            })
            ->whereNotNull("data->company_name")
            ->limit($limit)
            ->get();

        $resolvedCount = 0;
        foreach ($targets as $row) {
            $data = $row->data ?? [];
            $name = $data['company_name'] ?? '';
            $city = $data['city'] ?? '';
            if (empty($name)) continue;

            $query = trim("{$name} {$city} offizielle website");
            $search = $searchService->search($query, 3);
            $results = $search['results'] ?? [];

            foreach ($results as $res) {
                $url = $res['url'] ?? '';
                if ($searchService->isCatalogDomain($url)) continue;

                $domain = strtolower(trim(preg_replace('/^https?:\/\//', '', $url)));
                $domain = preg_replace('/\/.*$/', '', $domain);
                $domain = preg_replace('/^www\./', '', $domain);

                if (!empty($domain)) {
                    $data['domain'] = $domain;
                    $data['source_domain'] = $domain;
                    $row->update(['data' => $data]);
                    $resolvedCount++;
                    break;
                }
            }
        }

        return response()->json([
            'success' => true,
            'resolved' => $resolvedCount,
            'checked' => $targets->count(),
            'message' => "{$resolvedCount} Domains erfolgreich aufgelöst.",
        ]);
    }
}

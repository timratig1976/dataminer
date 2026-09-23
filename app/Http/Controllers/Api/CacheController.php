<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ScrapeCache;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CacheController extends Controller
{
    /**
     * Inspect cached scrape data for a given domain.
     * GET /api/cache?domain=...
     */
    public function index(Request $request): JsonResponse
    {
        $domain = $request->query('domain');
        if (!$domain) {
            return response()->json(['error' => 'domain required'], 400);
        }

        $cleanDomain = strtolower(trim(preg_replace('/^https?:\/\//', '', $domain)));
        $cleanDomain = preg_replace('/\/.*$/', '', $cleanDomain);
        $cleanDomain = preg_replace('/^www\./', '', $cleanDomain);

        $entries = ScrapeCache::where('url', 'ILIKE', "%{$cleanDomain}%")->get();

        return response()->json([
            'domain' => $cleanDomain,
            'entries' => $entries->map(fn($e) => [
                'url' => $e->url,
                'title' => $e->title,
                'length' => strlen($e->markdown ?? ''),
                'markdown' => $e->markdown,
                'fetchedAt' => $e->fetched_at?->toIso8601String() ?? $e->created_at?->toIso8601String(),
            ]),
        ]);
    }
}

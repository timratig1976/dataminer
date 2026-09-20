<?php

namespace App\Services;

use App\Models\GlobalSetting;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class MapsService
{
    /**
     * Search Google Maps places via Apify (best coverage + website), SerpAPI or Serper
     */
    public function search(string $query, ?string $location = null, int $limit = 20): array
    {
        $settings = GlobalSetting::instance();

        // 1. Apify Google Maps Scraper (Extracts real website, phone, full address, reviews)
        if (!empty($settings->apify_api_token)) {
            $apifyPlaces = $this->searchApify($query, $location, $limit, $settings->apify_api_token);
            if (!empty($apifyPlaces)) {
                return $apifyPlaces;
            }
        }

        // 2. SerpAPI Google Maps
        if (!empty($settings->serp_api_key)) {
            try {
                $params = [
                    'engine' => 'google_maps',
                    'q' => $location ? "{$query} {$location}" : $query,
                    'api_key' => $settings->serp_api_key,
                    'hl' => 'de',
                    'gl' => 'de',
                ];
                if ($location) {
                    $params['ll'] = $location;
                }

                $res = Http::timeout(15)->get('https://serpapi.com/search.json', $params);
                if ($res->successful()) {
                    $localResults = $res->json('local_results') ?? [];
                    if (!empty($localResults)) {
                        return $this->formatSerpApiResults($localResults, $limit);
                    }
                }
            } catch (\Throwable $e) {
                Log::warning("SerpAPI Maps search failed: " . $e->getMessage());
            }
        }

        // 3. Serper Maps Places
        if (!empty($settings->serper_api_key)) {
            try {
                $res = Http::timeout(15)
                    ->withHeaders(['X-API-KEY' => $settings->serper_api_key, 'Content-Type' => 'application/json'])
                    ->post('https://google.serper.dev/places', [
                        'q' => $location ? "{$query} {$location}" : $query,
                        'location' => $location,
                        'gl' => 'de',
                        'hl' => 'de',
                    ]);

                if ($res->successful()) {
                    $places = $res->json('places') ?? [];
                    if (!empty($places)) {
                        return $this->formatSerperResults($places, $limit);
                    }
                }

                // If places is empty, fallback to Serper organic search with local intent
                $fullQuery = trim(($location ? "{$query} {$location}" : $query) . " -site:wikipedia.org -site:statista.com -site:tripadvisor.de");
                $searchRes = Http::timeout(15)
                    ->withHeaders(['X-API-KEY' => $settings->serper_api_key, 'Content-Type' => 'application/json'])
                    ->post('https://google.serper.dev/search', [
                        'q' => $fullQuery,
                        'gl' => 'de',
                        'hl' => 'de',
                        'num' => min($limit, 10),
                    ]);

                if ($searchRes->successful()) {
                    $organic = $searchRes->json('organic') ?? [];
                    $out = [];
                    foreach (array_slice($organic, 0, $limit) as $r) {
                        $out[] = [
                            'name' => $r['title'] ?? '',
                            'address' => '',
                            'phone' => '',
                            'website' => $r['link'] ?? '',
                            'rating' => null,
                            'reviews' => null,
                            'category' => '',
                            'mapsUrl' => '',
                        ];
                    }
                    if (!empty($out)) {
                        return $out;
                    }
                }
            } catch (\Throwable $e) {
                Log::warning("Serper Maps search failed: " . $e->getMessage());
            }
        }

        return [];
    }

    protected function searchApify(string $query, ?string $location, int $limit, string $token): array
    {
        try {
            $searchQuery = $location ? "{$query} in {$location}" : $query;
            $res = Http::timeout(30)
                ->withHeaders([
                    'Authorization' => "Bearer {$token}",
                    'Content-Type' => 'application/json',
                ])
                ->post('https://api.apify.com/v2/acts/compass~crawler-google-places/runs', [
                    'searchStringsArray' => [$searchQuery],
                    'maxCrawledPlacesPerSearch' => min($limit, 20),
                    'language' => 'de',
                    'skipClosedPlaces' => false,
                ]);

            if (!$res->successful()) {
                Log::warning("Apify start run failed: " . $res->status());
                return [];
            }

            $runId = $res->json('data.id');
            $datasetId = $res->json('data.defaultDatasetId');
            if (!$runId || !$datasetId) return [];

            // Poll max 60s
            $deadline = time() + 60;
            while (time() < $deadline) {
                sleep(2);
                $statusRes = Http::timeout(10)
                    ->withHeaders(['Authorization' => "Bearer {$token}"])
                    ->get("https://api.apify.com/v2/actor-runs/{$runId}");

                $status = $statusRes->json('data.status');
                if ($status === 'SUCCEEDED') break;
                if (in_array($status, ['FAILED', 'ABORTED', 'TIMED-OUT'])) return [];
            }

            $itemsRes = Http::timeout(15)
                ->withHeaders(['Authorization' => "Bearer {$token}"])
                ->get("https://api.apify.com/v2/datasets/{$datasetId}/items?clean=true&format=json&limit={$limit}");

            if (!$itemsRes->successful()) return [];

            $items = $itemsRes->json() ?? [];
            $out = [];
            foreach ($items as $item) {
                if (empty($item['title'])) continue;
                $out[] = [
                    'name' => $item['title'] ?? '',
                    'address' => $item['address'] ?? '',
                    'phone' => $item['phone'] ?? '',
                    'website' => $item['website'] ?? '',
                    'rating' => $item['totalScore'] ?? null,
                    'reviews' => $item['reviewsCount'] ?? null,
                    'category' => $item['categoryName'] ?? '',
                    'mapsUrl' => $item['url'] ?? '',
                ];
            }
            return $out;
        } catch (\Throwable $e) {
            Log::warning("Apify Maps search failed: " . $e->getMessage());
            return [];
        }
    }

    protected function formatSerpApiResults(array $places, int $limit): array
    {
        $out = [];
        foreach (array_slice($places, 0, $limit) as $p) {
            $cid = $p['data_cid'] ?? $p['place_id'] ?? null;
            $mapsUrl = $p['link'] ?? ($cid ? "https://www.google.com/maps/place/?q=place_id:{$cid}" : "https://www.google.com/maps/search/" . urlencode($p['title'] ?? ''));

            $out[] = [
                'name' => $p['title'] ?? '',
                'address' => $p['address'] ?? '',
                'phone' => $p['phone'] ?? '',
                'website' => $p['website'] ?? '',
                'rating' => $p['rating'] ?? null,
                'reviews' => $p['reviews'] ?? null,
                'category' => $p['type'] ?? '',
                'mapsUrl' => $mapsUrl,
            ];
        }
        return $out;
    }

    protected function formatSerperResults(array $places, int $limit): array
    {
        $out = [];
        foreach (array_slice($places, 0, $limit) as $p) {
            $cid = $p['cid'] ?? null;
            $mapsUrl = $cid ? "https://www.google.com/maps/place/?q=place_id:{$cid}" : "https://www.google.com/maps/search/" . urlencode($p['title'] ?? '');

            $out[] = [
                'name' => $p['title'] ?? '',
                'address' => $p['address'] ?? '',
                'phone' => $p['phoneNumber'] ?? $p['phone'] ?? '',
                'website' => $p['website'] ?? '',
                'rating' => $p['rating'] ?? null,
                'reviews' => $p['ratingCount'] ?? null,
                'category' => $p['category'] ?? '',
                'mapsUrl' => $mapsUrl,
            ];
        }
        return $out;
    }
}

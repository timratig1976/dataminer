<?php

namespace App\Services;

use App\Models\GlobalSetting;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class MapsService
{
    /**
     * Search Google Maps places via Serper /maps, SerpAPI or Serper /places
     */
    public function search(string $query, ?string $location = null, int $limit = 100): array
    {
        $settings = GlobalSetting::instance();
        $fullQuery = $location ? "{$query} {$location}" : $query;

        // 1. Serper Google Maps Engine (/maps) — Has FULL Google Maps Data (Website, Phone, Rating, Description)
        if (!empty($settings->serper_api_key)) {
            try {
                $res = Http::timeout(15)
                    ->withHeaders(['X-API-KEY' => $settings->serper_api_key, 'Content-Type' => 'application/json'])
                    ->post('https://google.serper.dev/maps', [
                        'q' => $fullQuery,
                        'gl' => 'de',
                        'hl' => 'de',
                    ]);

                if ($res->successful()) {
                    $places = $res->json('places') ?? [];
                    if (!empty($places)) {
                        return $this->formatSerperMapsResults($places, $limit);
                    }
                }
            } catch (\Throwable $e) {
                Log::warning("Serper /maps failed: " . $e->getMessage());
            }
        }

        // 2. SerpAPI Google Maps (Fallback)
        if (!empty($settings->serp_api_key)) {
            try {
                $params = [
                    'engine' => 'google_maps',
                    'q' => $fullQuery,
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

        // 3. Serper /places (Fallback)
        if (!empty($settings->serper_api_key)) {
            try {
                $res = Http::timeout(15)
                    ->withHeaders(['X-API-KEY' => $settings->serper_api_key, 'Content-Type' => 'application/json'])
                    ->post('https://google.serper.dev/places', [
                        'q' => $fullQuery,
                        'gl' => 'de',
                        'hl' => 'de',
                    ]);

                if ($res->successful()) {
                    $places = $res->json('places') ?? [];
                    if (!empty($places)) {
                        return $this->formatSerperResults($places, $limit);
                    }
                }
            } catch (\Throwable $e) {
                Log::warning("Serper /places failed: " . $e->getMessage());
            }
        }

        return [];
    }

    protected function formatSerperMapsResults(array $places, int $limit): array
    {
        $out = [];
        foreach (array_slice($places, 0, $limit) as $p) {
            $cid = $p['cid'] ?? null;
            $mapsUrl = $cid ? "https://www.google.com/maps/place/?q=place_id:{$cid}" : ($p['placeId'] ? "https://www.google.com/maps/place/?q=place_id:{$p['placeId']}" : "https://www.google.com/maps/search/" . urlencode($p['title'] ?? ''));

            $out[] = [
                'name' => $p['title'] ?? '',
                'address' => $p['address'] ?? '',
                'phone' => $p['phoneNumber'] ?? '',
                'website' => $p['website'] ?? '',
                'rating' => $p['rating'] ?? null,
                'reviews' => $p['ratingCount'] ?? null,
                'category' => $p['type'] ?? (is_array($p['types'] ?? null) ? $p['types'][0] : ''),
                'mapsUrl' => $mapsUrl,
            ];
        }
        return $out;
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

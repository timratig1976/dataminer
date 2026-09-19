<?php

namespace App\Services;

use App\Models\GlobalSetting;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class MapsService
{
    /**
     * Search Google Maps places via SerpAPI or Serper
     */
    public function search(string $query, ?string $location = null, int $limit = 20): array
    {
        $settings = GlobalSetting::instance();

        // 1. SerpAPI Google Maps
        if (!empty($settings->serp_api_key)) {
            try {
                $params = [
                    'engine' => 'google_maps',
                    'q' => $query,
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
                    return $this->formatSerpApiResults($localResults, $limit);
                }
            } catch (\Throwable $e) {
                Log::warning("SerpAPI Maps search failed: " . $e->getMessage());
            }
        }

        // 2. Serper Maps
        if (!empty($settings->serper_api_key)) {
            try {
                $res = Http::timeout(15)
                    ->withHeaders(['X-API-KEY' => $settings->serper_api_key, 'Content-Type' => 'application/json'])
                    ->post('https://google.serper.dev/places', [
                        'q' => $query,
                        'location' => $location,
                        'gl' => 'de',
                        'hl' => 'de',
                    ]);

                if ($res->successful()) {
                    $places = $res->json('places') ?? [];
                    return $this->formatSerperResults($places, $limit);
                }
            } catch (\Throwable $e) {
                Log::warning("Serper Maps search failed: " . $e->getMessage());
            }
        }

        return [];
    }

    protected function formatSerpApiResults(array $places, int $limit): array
    {
        $out = [];
        foreach (array_slice($places, 0, $limit) as $p) {
            $out[] = [
                'name' => $p['title'] ?? '',
                'address' => $p['address'] ?? '',
                'phone' => $p['phone'] ?? '',
                'website' => $p['website'] ?? '',
                'rating' => $p['rating'] ?? null,
                'reviews' => $p['reviews'] ?? null,
                'category' => $p['type'] ?? '',
            ];
        }
        return $out;
    }

    protected function formatSerperResults(array $places, int $limit): array
    {
        $out = [];
        foreach (array_slice($places, 0, $limit) as $p) {
            $out[] = [
                'name' => $p['title'] ?? '',
                'address' => $p['address'] ?? '',
                'phone' => $p['phoneNumber'] ?? '',
                'website' => $p['website'] ?? '',
                'rating' => $p['rating'] ?? null,
                'reviews' => $p['ratingCount'] ?? null,
                'category' => $p['category'] ?? '',
            ];
        }
        return $out;
    }
}

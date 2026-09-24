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

        // 1. Serper Google Maps Engine (/maps) — Has FULL Google Maps Data with auto-pagination up to $limit
        if (!empty($settings->serper_api_key)) {
            try {
                $allPlaces = [];
                $page = 1;
                $ll = null;

                while (count($allPlaces) < $limit && $page <= 5) {
                    $payload = [
                        'q' => $fullQuery,
                        'gl' => 'de',
                        'hl' => 'de',
                    ];
                    if ($page > 1 && $ll) {
                        $payload['ll'] = $ll;
                        $payload['page'] = $page;
                    }

                    $res = Http::timeout(15)
                        ->withHeaders(['X-API-KEY' => $settings->serper_api_key, 'Content-Type' => 'application/json'])
                        ->post('https://google.serper.dev/maps', $payload);

                    if ($res->successful()) {
                        $batch = $res->json('places') ?? [];
                        if (empty($batch)) {
                            break;
                        }
                        // Capture GPS anchor from first page for smooth pagination
                        if (!$ll && !empty($batch[0]['latitude']) && !empty($batch[0]['longitude'])) {
                            $ll = "@{$batch[0]['latitude']},{$batch[0]['longitude']},14z";
                        }
                        $allPlaces = array_merge($allPlaces, $batch);
                        $page++;
                    } elseif ($res->status() === 400 && str_contains(strtolower($res->body()), 'not enough credits')) {
                        throw new \RuntimeException("Serper.dev API Credits aufgebraucht! Bitte Guthaben aufladen oder API-Key in den Einstellungen prüfen.");
                    } else {
                        break;
                    }
                }

                if (!empty($allPlaces)) {
                    return $this->formatSerperMapsResults($allPlaces, $limit);
                }
            } catch (\Throwable $e) {
                Log::warning("Serper /maps failed: " . $e->getMessage());
            }
        }

        // 2. SerpAPI Google Maps (Fallback with pagination support up to $limit)
        if (!empty($settings->serp_api_key)) {
            try {
                $allResults = [];
                $start = 0;

                while (count($allResults) < $limit) {
                    $params = [
                        'engine' => 'google_maps',
                        'q' => $fullQuery,
                        'api_key' => $settings->serp_api_key,
                        'hl' => 'de',
                        'gl' => 'de',
                    ];
                    if ($start > 0) {
                        $params['start'] = $start;
                    }

                    $res = Http::timeout(15)->get('https://serpapi.com/search.json', $params);
                    if (!$res->successful()) break;

                    $localResults = $res->json('local_results') ?? [];
                    if (empty($localResults)) break;

                    $allResults = array_merge($allResults, $localResults);
                    $start += 20;

                    // If less than 20 returned, we reached the end of Google Maps results
                    if (count($localResults) < 20) break;
                }

                if (!empty($allResults)) {
                    return $this->formatSerpApiResults($allResults, $limit);
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
                } elseif ($res->status() === 400 && str_contains(strtolower($res->body()), 'not enough credits')) {
                    throw new \RuntimeException("Serper.dev API Credits aufgebraucht! Bitte Guthaben aufladen oder API-Key in den Einstellungen prüfen.");
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
                'category' => $this->normalizeCategory($p['category'] ?? ''),
                'mapsUrl' => $mapsUrl,
            ];
        }
        return $out;
    }

    /**
     * Normalizes raw Google Maps cuisine/national categories into clean industry names.
     */
    public function normalizeCategory(?string $cat): string
    {
        $cat = trim($cat ?? '');
        if (empty($cat)) return '';

        // Known cuisines that Google maps directly without "Restaurant" -> unify to "Restaurant"
        $cuisineMap = [
            'griechisch' => 'Restaurant',
            'italienisch' => 'Restaurant',
            'deutsch' => 'Restaurant',
            'asiatisch' => 'Restaurant',
            'chinesisch' => 'Restaurant',
            'japanisch' => 'Restaurant',
            'indisch' => 'Restaurant',
            'türkisch' => 'Restaurant',
            'spanisch' => 'Restaurant',
            'mexikanisch' => 'Restaurant',
            'französisch' => 'Restaurant',
            'vietnamesisch' => 'Restaurant',
            'kroatisch' => 'Restaurant',
            'mediterran' => 'Restaurant',
            'amerikanisch' => 'Restaurant',
            'vegetarisch' => 'Restaurant',
            'vegan' => 'Restaurant',
            'gutbürgerlich' => 'Restaurant',
            'balkan' => 'Restaurant',
            'sushi' => 'Restaurant',
            'pizza' => 'Pizzeria',
            'burger' => 'Restaurant',
            'steakhouse' => 'Restaurant',
            'eiscafe' => 'Eiscafé',
            'eiscafé' => 'Eiscafé',
            'bäckerei' => 'Bäckerei & Café',
            'konditorei' => 'Café',
        ];

        $lower = mb_strtolower($cat);
        if (isset($cuisineMap[$lower])) {
            return $cuisineMap[$lower];
        }

        // If it already ends with Restaurant, Café, Bar, Hotel, etc., keep it
        return $cat;
    }
}

<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\GlobalSetting;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Http;

class ApiStatusController extends Controller
{
    /**
     * Check status and quotas of configured APIs.
     * GET /api/settings/health
     */
    public function check(): JsonResponse
    {
        $settings = GlobalSetting::instance();
        $statuses = [];

        // 1. Eden AI
        $edenKey = $settings->eden_api_key ?: env('EDEN_API_KEY');
        if (!$edenKey) {
            $statuses['eden'] = ['configured' => false, 'status' => 'missing', 'message' => 'Key nicht hinterlegt'];
        } else {
            $statuses['eden'] = ['configured' => true, 'status' => 'ok', 'message' => 'Bereit'];
        }

        // 2. SerpApi
        $serpKey = $settings->serp_api_key ?: env('SERP_API_KEY');
        if (!$serpKey) {
            $statuses['serpapi'] = ['configured' => false, 'status' => 'missing', 'message' => 'Key nicht hinterlegt'];
        } else {
            try {
                $res = Http::timeout(5)->get('https://serpapi.com/account', [
                    'api_key' => $serpKey,
                ]);
                $data = $res->json();
                if ($res->successful()) {
                    $searchesLeft = $data['total_searches_left'] ?? 0;
                    if ($searchesLeft <= 0) {
                        $statuses['serpapi'] = [
                            'configured' => true,
                            'status' => 'exhausted',
                            'message' => 'Limit aufgebraucht (0 Searches übrig)',
                            'limit' => 0,
                        ];
                    } else {
                        $statuses['serpapi'] = [
                            'configured' => true,
                            'status' => 'ok',
                            'message' => "{$searchesLeft} Searches übrig",
                            'limit' => $searchesLeft,
                        ];
                    }
                } else {
                    $statuses['serpapi'] = [
                        'configured' => true,
                        'status' => 'error',
                        'message' => $data['error'] ?? 'Ungültig oder abgelaufen',
                    ];
                }
            } catch (\Throwable $e) {
                $statuses['serpapi'] = ['configured' => true, 'status' => 'error', 'message' => 'Verbindung fehlgeschlagen'];
            }
        }

        // 3. Serper.dev
        $serperKey = $settings->serper_api_key ?: env('SERPER_API_KEY');
        if (!$serperKey) {
            $statuses['serper'] = ['configured' => false, 'status' => 'missing', 'message' => 'Key nicht hinterlegt'];
        } else {
            try {
                $res = Http::timeout(5)
                    ->withHeaders(['X-API-KEY' => $serperKey, 'Content-Type' => 'application/json'])
                    ->post('https://google.serper.dev/search', ['q' => 'test', 'num' => 1]);
                if ($res->successful()) {
                    $statuses['serper'] = [
                        'configured' => true,
                        'status' => 'ok',
                        'message' => 'Aktiv & einsatzbereit',
                    ];
                } else {
                    $statuses['serper'] = ['configured' => true, 'status' => 'error', 'message' => 'Key ungültig (HTTP ' . $res->status() . ')'];
                }
            } catch (\Throwable $e) {
                $statuses['serper'] = ['configured' => true, 'status' => 'error', 'message' => 'Verbindung fehlgeschlagen'];
            }
        }

        // 4. Apify
        $apifyToken = $settings->apify_api_token ?: env('APIFY_API_TOKEN');
        if (!$apifyToken) {
            $statuses['apify'] = ['configured' => false, 'status' => 'missing', 'message' => 'Token nicht hinterlegt'];
        } else {
            try {
                $limitsRes = Http::timeout(6)
                    ->withHeaders(['Authorization' => "Bearer {$apifyToken}"])
                    ->get('https://api.apify.com/v2/users/me/limits');

                if ($limitsRes->successful()) {
                    $limitsData = $limitsRes->json('data') ?? [];
                    $maxUsd = (float) ($limitsData['limits']['maxMonthlyUsageUsd'] ?? 19);
                    $usedUsd = (float) ($limitsData['current']['monthlyUsageUsd'] ?? 0);
                    $remainingUsd = max(0, $maxUsd - $usedUsd);

                    if ($remainingUsd < 0.20) {
                        $statuses['apify'] = [
                            'configured' => true,
                            'status' => 'exhausted',
                            'message' => "Budget aufgebraucht: $" . number_format($remainingUsd, 2) . " / $" . number_format($maxUsd, 2) . " übrig",
                            'limit' => $remainingUsd,
                        ];
                    } else {
                        $statuses['apify'] = [
                            'configured' => true,
                            'status' => 'ok',
                            'message' => "$" . number_format($remainingUsd, 2) . " Guthaben übrig",
                            'limit' => $remainingUsd,
                        ];
                    }
                } else {
                    $statuses['apify'] = ['configured' => true, 'status' => 'error', 'message' => 'Token ungültig (HTTP ' . $limitsRes->status() . ')'];
                }
            } catch (\Throwable $e) {
                $statuses['apify'] = ['configured' => true, 'status' => 'error', 'message' => 'Verbindung fehlgeschlagen'];
            }
        }

        // 5. Firecrawl
        $fcKey = $settings->firecrawl_api_key ?: env('FIRECRAWL_API_KEY');
        if (!$fcKey) {
            $statuses['firecrawl'] = ['configured' => false, 'status' => 'missing', 'message' => 'Key nicht hinterlegt'];
        } else {
            $statuses['firecrawl'] = ['configured' => true, 'status' => 'ok', 'message' => 'Bereit'];
        }

        $flaws = [];
        foreach ($statuses as $provider => $st) {
            if ($st['status'] === 'exhausted' || $st['status'] === 'error') {
                $flaws[] = [
                    'provider' => $provider,
                    'status' => $st['status'],
                    'message' => $st['message'],
                ];
            }
        }

        return response()->json([
            'statuses' => $statuses,
            'flaws' => $flaws,
            'has_flaw' => count($flaws) > 0,
        ]);
    }
}

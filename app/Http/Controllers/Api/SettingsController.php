<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\GlobalSetting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SettingsController extends Controller
{
    /**
     * Get global application settings.
     * Sensitive API keys are masked for security unless explicit.
     * GET /api/settings
     */
    public function show(): JsonResponse
    {
        $settings = GlobalSetting::instance();

        $mask = function (?string $key): ?string {
            if (!$key) return null;
            return strlen($key) > 8 ? substr($key, 0, 4) . '...' . substr($key, -4) : '••••••••';
        };

        return response()->json([
            'settings' => [
                'eden_region' => $settings->eden_region ?? 'eu',
                'model_allowlist' => $settings->model_allowlist ?? [],
                'catalog_domains' => $settings->catalog_domains ?? [],
                'planner_system_prompt' => $settings->planner_system_prompt,

                'edenApiKeyMasked' => $mask($settings->eden_api_key),
                'serperApiKeyMasked' => $mask($settings->serper_api_key),
                'serpApiKeyMasked' => $mask($settings->serp_api_key),
                'braveApiKeyMasked' => $mask($settings->brave_api_key),
                'apifyApiTokenMasked' => $mask($settings->apify_api_token),
                'firecrawlApiKeyMasked' => $mask($settings->firecrawl_api_key),

                'has_eden_api_key' => !empty($settings->eden_api_key),
                'has_serp_api_key' => !empty($settings->serp_api_key),
                'has_serper_api_key' => !empty($settings->serper_api_key),
                'has_brave_api_key' => !empty($settings->brave_api_key),
                'has_apify_api_token' => !empty($settings->apify_api_token),
                'has_firecrawl_api_key' => !empty($settings->firecrawl_api_key),
                'outbound_proxy_url' => env('OUTBOUND_PROXY_URL') ?: env('HTTP_PROXY') ?: env('HTTPS_PROXY') ?: null,

                'hasKey' => !empty($settings->eden_api_key),
                'hasFirecrawlKey' => !empty($settings->firecrawl_api_key),
                'envKeyPresent' => !empty(env('EDEN_API_KEY')),
                'firecrawlEnvPresent' => !empty(env('FIRECRAWL_API_KEY')),
                'serperEnvPresent' => !empty(env('SERPER_API_KEY')),
                'serpEnvPresent' => !empty(env('SERP_API_KEY')),
                'braveEnvPresent' => !empty(env('BRAVE_API_KEY')),
                'apifyEnvPresent' => !empty(env('APIFY_API_TOKEN')),
                'updatedAt' => $settings->updated_at,
            ]
        ]);
    }

    /**
     * Update global settings and API keys.
     * PUT /api/settings
     */
    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'eden_api_key' => 'nullable|string',
            'eden_region' => 'nullable|string|in:us,eu',
            'model_allowlist' => 'nullable|array',
            'catalog_domains' => 'nullable|array',
            'serper_api_key' => 'nullable|string',
            'serp_api_key' => 'nullable|string',
            'brave_api_key' => 'nullable|string',
            'apify_api_token' => 'nullable|string',
            'firecrawl_api_key' => 'nullable|string',
            'planner_system_prompt' => 'nullable|string',
        ]);

        $settings = GlobalSetting::instance();

        // Only update keys that were explicitly supplied and not empty placeholders
        foreach ($data as $key => $value) {
            if ($value !== null) {
                $settings->{$key} = $value;
            }
        }

        $settings->save();

        return response()->json([
            'message' => 'Settings updated successfully',
            'updated_at' => $settings->updated_at,
        ]);
    }

    /**
     * DELETE /api/settings?key=eden|firecrawl|serper|serp|brave|apify
     */
    public function destroyKey(Request $request): JsonResponse
    {
        $keyName = $request->input('key') ?: $request->query('key');
        $map = [
            'eden' => 'eden_api_key',
            'firecrawl' => 'firecrawl_api_key',
            'serper' => 'serper_api_key',
            'serp' => 'serp_api_key',
            'serpapi' => 'serp_api_key',
            'brave' => 'brave_api_key',
            'apify' => 'apify_api_token',
        ];

        if (!isset($map[$keyName])) {
            return response()->json(['error' => "Unknown key: {$keyName}"], 400);
        }

        $settings = GlobalSetting::instance();
        $settings->{$map[$keyName]} = null;
        $settings->save();

        return response()->json(['message' => "Key {$keyName} deleted", 'ok' => true]);
    }

    /**
     * POST /api/settings/test-eden
     */
    public function testEden(Request $request, \App\Services\EdenAiService $edenAi): JsonResponse
    {
        $settings = GlobalSetting::instance();
        $apiKey = $request->input('apiKey') ?: ($settings->eden_api_key ?: env('EDEN_API_KEY'));

        if (!$apiKey) {
            return response()->json(['ok' => false, 'error' => 'Kein Eden AI API-Key vorhanden.'], 400);
        }

        $t0 = microtime(true);
        try {
            $region = $request->input('region') ?: ($settings->eden_region ?: 'eu');
            $modelInput = $request->input('model');
            if ($modelInput) {
                $testModel = $modelInput;
            } else {
                // In Eden AI EU region, OpenAI models are restricted; use mistral if eu, otherwise openai
                $testModel = $region === 'eu' ? 'mistral/mistral-small-latest' : 'openai/gpt-4o-mini';
            }
            $testPrompt = $request->input('prompt') ?: 'Reply with exactly: ok';

            $resp = $edenAi->chatCompletion(
                apiKey: $apiKey,
                model: $testModel,
                system: 'You are a smoke test responder.',
                prompt: $testPrompt,
                region: $region
            );

            return response()->json([
                'ok' => true,
                'region' => $region,
                'latencyMs' => round((microtime(true) - $t0) * 1000),
                'preview' => substr($resp['raw'] ?? 'ok', 0, 80),
                'costUsd' => $resp['cost_usd'] ?? $resp['cost'] ?? 0,
            ]);
        } catch (\Throwable $e) {
            $err = $e->getMessage();
            if (str_contains($err, '451') || str_contains($err, 'not available on the EU')) {
                $err = "Model ist auf EU-Endpoint nicht verfügbar. Tipp: Wechsle Region auf 'US' für OpenAI oder nutze 'mistral/'.";
            }
            return response()->json([
                'ok' => false,
                'error' => $err,
                'latencyMs' => round((microtime(true) - $t0) * 1000),
            ]);
        }
    }

    /**
     * POST /api/settings/test-search
     */
    public function testSearch(Request $request, \App\Services\SearchService $searchService, \App\Services\MapsService $mapsService): JsonResponse
    {
        $provider = $request->input('provider');
        $bodyKey = $request->input('apiKey');
        $query = $request->input('query') ?: 'Handwerker Berlin';

        $settings = GlobalSetting::instance();
        $t0 = microtime(true);

        try {
            if ($provider === 'serper') {
                $key = $bodyKey ?: ($settings->serper_api_key ?: env('SERPER_API_KEY'));
                if (!$key) return response()->json(['ok' => false, 'error' => 'Kein Serper-Key vorhanden']);
                $res = $searchService->searchSerper($query, $key, 3);
                return response()->json([
                    'ok' => count($res) > 0,
                    'provider' => 'serper',
                    'hits' => count($res),
                    'sample' => $res[0]['title'] ?? '',
                    'note' => 'Google Web-Suche via Serper.dev',
                    'latencyMs' => round((microtime(true) - $t0) * 1000),
                ]);
            }

            if ($provider === 'serp' || $provider === 'serpapi') {
                $key = $bodyKey ?: ($settings->serp_api_key ?: env('SERP_API_KEY'));
                if (!$key) return response()->json(['ok' => false, 'error' => 'Kein SerpAPI-Key vorhanden']);
                $res = $searchService->searchSerpApi($query, $key, 3);
                return response()->json([
                    'ok' => count($res) > 0,
                    'provider' => 'serpapi',
                    'hits' => count($res),
                    'sample' => $res[0]['title'] ?? '',
                    'note' => 'Google Web-Suche via SerpApi',
                    'latencyMs' => round((microtime(true) - $t0) * 1000),
                ]);
            }

            if ($provider === 'brave') {
                $key = $bodyKey ?: ($settings->brave_api_key ?: env('BRAVE_API_KEY'));
                if (!$key) return response()->json(['ok' => false, 'error' => 'Kein Brave-Key vorhanden']);
                $res = $searchService->searchBrave($query, $key, 3);
                return response()->json([
                    'ok' => count($res) > 0,
                    'provider' => 'brave',
                    'hits' => count($res),
                    'sample' => $res[0]['title'] ?? '',
                    'note' => 'Brave Search API',
                    'latencyMs' => round((microtime(true) - $t0) * 1000),
                ]);
            }

            if ($provider === 'firecrawl') {
                $key = $bodyKey ?: ($settings->firecrawl_api_key ?: env('FIRECRAWL_API_KEY'));
                if (!$key) return response()->json(['ok' => false, 'error' => 'Kein Firecrawl-Key vorhanden']);

                // Firecrawl v1 scrape test against example.com
                $response = \Illuminate\Support\Facades\Http::withHeaders([
                    'Authorization' => "Bearer {$key}",
                    'Content-Type' => 'application/json',
                ])->timeout(15)->post('https://api.firecrawl.dev/v1/scrape', [
                    'url' => 'https://example.com',
                    'formats' => ['markdown'],
                ]);

                if ($response->successful()) {
                    $json = $response->json();
                    $markdown = $json['data']['markdown'] ?? '';
                    return response()->json([
                        'ok' => !empty($markdown),
                        'provider' => 'firecrawl',
                        'hits' => 1,
                        'sample' => substr($markdown, 0, 80) . '...',
                        'note' => 'Direkte Firecrawl API (v1/scrape)',
                        'latencyMs' => round((microtime(true) - $t0) * 1000),
                    ]);
                } else {
                    return response()->json([
                        'ok' => false,
                        'error' => 'Firecrawl API Fehler: HTTP ' . $response->status(),
                    ]);
                }
            }

            if ($provider === 'apify') {
                $token = $bodyKey ?: ($settings->apify_api_token ?: env('APIFY_API_TOKEN'));
                if (!$token) return response()->json(['ok' => false, 'error' => 'Kein Apify-Token vorhanden']);

                $response = \Illuminate\Support\Facades\Http::withHeaders([
                    'Authorization' => "Bearer {$token}",
                ])->timeout(10)->get('https://api.apify.com/v2/users/me');

                if ($response->successful()) {
                    $json = $response->json();
                    $username = $json['data']['username'] ?? 'User';
                    return response()->json([
                        'ok' => true,
                        'provider' => 'apify',
                        'hits' => 1,
                        'sample' => "Angemeldet als {$username}",
                        'note' => 'Apify Actor Platform Authenticated',
                        'latencyMs' => round((microtime(true) - $t0) * 1000),
                    ]);
                } else {
                    return response()->json([
                        'ok' => false,
                        'error' => 'Apify Authentifizierung fehlgeschlagen: HTTP ' . $response->status(),
                    ]);
                }
            }

            if ($provider === 'serper-places') {
                $key = $bodyKey ?: ($settings->serper_api_key ?: env('SERPER_API_KEY'));
                if (!$key) return response()->json(['ok' => false, 'error' => 'Kein Serper-Key vorhanden']);
                $res = $mapsService->search($query, 'Berlin', 3);
                return response()->json([
                    'ok' => count($res) > 0,
                    'provider' => 'serper-places',
                    'hits' => count($res),
                    'sample' => $res[0]['name'] ?? '',
                    'note' => 'Google Places via Serper.dev',
                    'latencyMs' => round((microtime(true) - $t0) * 1000),
                ]);
            }

            return response()->json(['ok' => false, 'error' => "Unbekannter Provider: {$provider}"]);
        } catch (\Throwable $e) {
            return response()->json(['ok' => false, 'error' => $e->getMessage()]);
        }
    }

    /**
     * GET /api/settings/test-planner
     */
    public function getPlannerPrompt(\App\Services\PlannerService $planner): JsonResponse
    {
        $settings = GlobalSetting::instance();
        return response()->json([
            'defaultPrompt' => $planner->buildDefaultSystemPrompt(),
            'currentOverride' => $settings->planner_system_prompt,
        ]);
    }

    /**
     * POST /api/settings/test-planner
     */
    public function testPlanner(Request $request, \App\Services\PlannerService $planner): JsonResponse
    {
        $prompt = trim($request->input('prompt') ?: $request->input('goal') ?: '');
        if (!$prompt) {
            return response()->json(['error' => 'Such-Ziel (prompt) erforderlich'], 400);
        }

        $maxResults = (int) ($request->input('maxResults') ?: 50);
        $systemPrompt = $request->has('systemPrompt') ? $request->input('systemPrompt') : null;

        $t0 = microtime(true);
        try {
            $plan = $planner->createPlan($prompt, $maxResults, $systemPrompt);
            return response()->json([
                'plan' => $plan,
                'latencyMs' => round((microtime(true) - $t0) * 1000),
                'usedOverride' => !empty($systemPrompt),
            ]);
        } catch (\Throwable $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }
}

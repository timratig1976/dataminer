<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\GlobalSetting;
use App\Services\EdenAiService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class LlmTestController extends Controller
{
    /**
     * List available models.
     * GET /api/llm/models
     */
    public function models(): JsonResponse
    {
        $settings = GlobalSetting::instance();
        $defaultModels = [
            'openai/gpt-4o-mini', 'openai/gpt-4o',
            'anthropic/claude-3-5-haiku-latest', 'anthropic/claude-sonnet-4-5',
            'mistral/mistral-small-latest', 'mistral/mistral-large-latest',
            'google/gemini-flash-latest', 'google/gemini-pro-latest',
            'meta/llama3.3-70b',
        ];

        return response()->json([
            'models' => $settings->model_allowlist ?: $defaultModels,
            'allModels' => $defaultModels,
        ]);
    }

    /**
     * Smoke test models.
     * POST /api/llm/smoke
     */
    public function smoke(Request $request, EdenAiService $edenAi): JsonResponse
    {
        $global = GlobalSetting::instance();
        $apiKey = $request->input('apiKey') ?: ($global->eden_api_key ?: env('EDEN_API_KEY'));
        $region = $request->input('region') ?: ($global->eden_region ?: 'eu');
        $defaultModel = $region === 'eu' ? 'mistral/mistral-small-latest' : 'openai/gpt-4o-mini';
        $models = $request->input('models') ?: [$defaultModel];
        $prompt = $request->input('prompt', 'Reply with exactly: ok');

        if (!$apiKey) {
            return response()->json(['error' => 'No Eden API key configured', 'ok' => false], 400);
        }

        $results = [];
        foreach ($models as $m) {
            $t0 = microtime(true);
            try {
                $res = $edenAi->chatCompletion($apiKey, $m, 'You are a tester.', $prompt, 800, 0.0, $region);
                $results[] = [
                    'model' => $m,
                    'ok' => true,
                    'latencyMs' => round((microtime(true) - $t0) * 1000),
                    'preview' => substr($res['raw'] ?? 'ok', 0, 80),
                ];
            } catch (\Throwable $e) {
                $results[] = [
                    'model' => $m,
                    'ok' => false,
                    'latencyMs' => round((microtime(true) - $t0) * 1000),
                    'error' => $e->getMessage(),
                ];
            }
        }

        $allOk = count($results) > 0 && collect($results)->every(fn($r) => $r['ok']);
        $firstOk = collect($results)->firstWhere('ok', true);
        $firstErr = collect($results)->firstWhere('ok', false);

        return response()->json([
            'ok' => $allOk,
            'results' => $results,
            'latencyMs' => $firstOk['latencyMs'] ?? $firstErr['latencyMs'] ?? 0,
            'preview' => $firstOk['preview'] ?? null,
            'error' => $firstErr['error'] ?? null,
        ]);
    }

    /**
     * Compare responses from multiple models.
     * POST /api/llm/compare
     */
    public function compare(Request $request, EdenAiService $edenAi): JsonResponse
    {
        return $this->smoke($request, $edenAi);
    }
}

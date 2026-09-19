<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Http\Client\Response;
use Exception;

class EdenAiService
{
    protected string $usBaseUrl = 'https://api.edenai.run';
    protected string $euBaseUrl = 'https://api.edenai.eu';

    /**
     * Chat completion call via Eden AI
     */
    public function chatCompletion(
        string $apiKey,
        string $model,
        string $system,
        string $prompt,
        int $maxTokens = 800,
        float $temperature = 0.0,
        string $region = 'us'
    ): array {
        $baseUrl = $region === 'eu' ? $this->euBaseUrl : $this->usBaseUrl;
        $endpoint = "{$baseUrl}/v3/chat/completions";

        $response = Http::withHeaders([
            'Authorization' => "Bearer {$apiKey}",
            'Content-Type' => 'application/json',
        ])
        ->timeout(60)
        ->retry(3, 1500, function ($exception, $request) {
            $msg = $exception->getMessage();
            return str_contains($msg, 'timeout') || str_contains($msg, '429') || str_contains($msg, 'rate limit');
        })
        ->post($endpoint, [
            'model' => $model,
            'messages' => [
                ['role' => 'system', 'content' => $system],
                ['role' => 'user', 'content' => $prompt],
            ],
            'max_tokens' => $maxTokens,
            'temperature' => $temperature,
        ]);

        if (!$response->successful()) {
            throw new Exception("Eden AI Chat Error: " . $response->body());
        }

        $json = $response->json();
        $raw = $json['choices'][0]['message']['content'] ?? '';
        $tokens = $json['usage'] ?? ['total_tokens' => 0];

        return [
            'raw' => $raw,
            'tokens' => [
                'total' => $tokens['total_tokens'] ?? 0,
            ],
            'cost_usd' => $json['cost'] ?? null,
        ];
    }

    /**
     * Scrape URL via Firecrawl on Eden AI US endpoint
     */
    public function scrapeUrl(string $apiKey, string $url): array
    {
        $endpoint = "{$this->usBaseUrl}/v3/universal-ai";

        $response = Http::withHeaders([
            'Authorization' => "Bearer {$apiKey}",
            'Content-Type' => 'application/json',
        ])
        ->timeout(30)
        ->retry(2, 2000, function ($exception, $request) {
            $msg = $exception->getMessage();
            return str_contains($msg, 'timeout') || str_contains($msg, '429');
        })
        ->post($endpoint, [
            'model' => 'web/scraping/firecrawl',
            'input' => [
                'url' => $url,
                'formats' => ['markdown'],
            ],
            'show_original_response' => false,
        ]);

        if (!$response->successful()) {
            throw new Exception("Eden AI Scrape Error: " . $response->body());
        }

        $json = $response->json();
        $data = $json['output']['data'] ?? $json['output'] ?? [];
        $markdown = trim($data['markdown'] ?? $data['content'] ?? '');
        $title = trim($data['title'] ?? '');

        return [
            'markdown' => $markdown,
            'title' => $title,
            'cost_usd' => is_numeric($json['cost'] ?? null) ? (float) $json['cost'] : 0.004,
        ];
    }
}

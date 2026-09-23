<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DataCase;
use App\Models\Row;
use App\Models\GlobalSetting;
use App\Models\CaseLog;
use App\Services\BatchEnrichService;
use App\Services\ContactSearchService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Exception;

class CellRunController extends Controller
{
    /**
     * Run a single AI cell immediately and synchronously.
     * POST /api/run/cell
     */
    public function run(
        Request $request,
        BatchEnrichService $batchEnrich,
        ContactSearchService $contactSearch
    ): JsonResponse {
        $validated = $request->validate([
            'caseId' => 'required|string',
            'rowId' => 'required|string',
            'columnId' => 'required|string',
        ]);

        $case = DataCase::findOrFail($validated['caseId']);
        $row = Row::where('case_id', $case->id)->where('id', $validated['rowId'])->firstOrFail();

        // Find AI column
        $aiCols = $case->ai_columns ?? [];
        $column = null;
        foreach ($aiCols as $c) {
            if (($c['id'] ?? '') === $validated['columnId'] || ($c['outputKey'] ?? '') === $validated['columnId']) {
                $column = $c;
                break;
            }
        }

        if (!$column) {
            return response()->json(['error' => 'Column not found'], 404);
        }

        $global = GlobalSetting::instance();
        $apiKey = $case->eden_api_key ?: ($global->eden_api_key ?: env('EDEN_API_KEY'));
        if (!$apiKey) {
            return response()->json(['error' => 'No Eden API key configured'], 400);
        }

        $outputKey = $column['outputKey'] ?? $validated['columnId'];
        $tool = $column['tool'] ?? null;
        $region = $case->eden_region ?: ($global->eden_region ?: 'eu');
        $model = $column['model'] ?? ($region === 'eu' ? 'mistral/mistral-small-latest' : 'openai/gpt-4o-mini');

        // Set status to running
        $statuses = $row->cell_statuses ?? [];
        $statuses[$outputKey] = 'running';
        $row->update(['cell_statuses' => $statuses]);

        $company = $row->data['company_name'] ?? $row->data['name'] ?? ("Zeile #" . (($row->row_index ?? 0) + 1));
        $colName = $column['name'] ?? $outputKey;
        CaseLog::record($case->id, "▶ [{$colName}] {$company} gestartet (Model: {$model})");

        try {
            if ($tool === 'batch_contact') {
                $result = $contactSearch->searchContacts(
                    rowData: $row->data ?? [],
                    apiKey: $apiKey,
                    maxContacts: $column['batchContactsMax'] ?? 3,
                    model: $model,
                    customSystemPrompt: !empty($column['prompt']) ? $column['prompt'] : null,
                    region: $region,
                    searchLinkedIn: !empty($column['batchContactsLinkedIn'])
                );

                $row->refresh();
                $data = $row->data ?? [];
                $statuses = $row->cell_statuses ?? [];

                if (!empty($result['contacts'])) {
                    $data["_contacts_json_{$outputKey}"] = json_encode($result['contacts']);
                    $summary = count($result['contacts']) . ' Kontakte gefunden';

                    // Sync into contact_rows table for the Kontakte tab
                    \App\Models\ContactRow::where('case_id', $case->id)
                        ->where('company_row_id', $row->id)
                        ->delete();

                    foreach ($result['contacts'] as $c) {
                        \App\Models\ContactRow::create([
                            'id' => (string) \Illuminate\Support\Str::uuid(),
                            'case_id' => $case->id,
                            'company_row_id' => $row->id,
                            'row_index' => \App\Models\ContactRow::where('case_id', $case->id)->count(),
                            'data' => [
                                'company_name' => $row->data['company_name'] ?? $row->data['Unternehmen'] ?? '',
                                'first_name' => $c['first_name'] ?? null,
                                'last_name' => $c['last_name'] ?? null,
                                'position' => $c['position'] ?? null,
                                'email' => $c['email'] ?? null,
                                'phone' => $c['phone'] ?? $row->data['phone'] ?? null,
                                'linkedin' => $c['linkedin'] ?? null,
                                'domain' => $row->data['domain'] ?? null,
                                'city' => $row->data['city'] ?? null,
                            ],
                        ]);
                    }
                } else {
                    $summary = '—';
                }
                if (!empty($result['company_email'])) {
                    $data['company_email'] = $result['company_email'];
                }
                $data[$outputKey] = $summary;

                $statuses[$outputKey] = 'done';
                $row->update(['data' => $data, 'cell_statuses' => $statuses]);

                CaseLog::record($case->id, "✓ [{$colName}] {$company} — {$summary}");

                return response()->json([
                    'status' => 'done',
                    'row' => $row,
                    'result' => $summary,
                ]);
            } elseif ($tool === 'batch_company' || $tool === 'batch_enrich' || empty($tool) && empty($column['prompt'])) {
                $fields = $column['batchOutputFields'] ?? ['company_name', 'domain', 'phone', 'company_email', 'address', 'city', 'zip', 'industry', 'description'];
                $crawlSources = $column['crawlSources'] ?? [];
                $result = $batchEnrich->enrichRow(
                    rowData: $row->data ?? [],
                    apiKey: $apiKey,
                    requestedFields: $fields,
                    model: $model,
                    customSystemPrompt: !empty($column['prompt']) ? $column['prompt'] : null,
                    region: $region,
                    crawlSources: $crawlSources
                );

                $row->refresh();
                $data = array_merge($row->data ?? [], $result['fields'] ?? []);
                $statuses = $row->cell_statuses ?? [];

                $filled = count(array_filter($result['fields'] ?? []));
                $summary = "{$filled}/" . count($fields) . " Felder angereichert";
                $data[$outputKey] = $summary;
                $data['_scrape_cached_ts'] = now()->toIso8601String();
                $data['_scrape_origin'] = $result['source_origin'] ?? 'live:scrape';

                $statuses[$outputKey] = 'done';
                $row->update(['data' => $data, 'cell_statuses' => $statuses]);

                CaseLog::record($case->id, "✓ [{$colName}] {$company} — {$summary}");

                return response()->json([
                    'status' => 'done',
                    'row' => $row,
                    'result' => $summary,
                    'fields' => $result['fields'] ?? [],
                ]);
            } else {
                // Custom prompt AI column
                $promptTemplate = $column['prompt'] ?? '';
                $renderedPrompt = $promptTemplate;
                foreach ($row->data ?? [] as $k => $v) {
                    $renderedPrompt = str_replace('{' . $k . '}', (string) $v, $renderedPrompt);
                }

                // Multi-Search Steps or single WebSearch execution
                $searchContextBlocks = [];
                $searchSteps = $column['searchSteps'] ?? [];

                if (!empty($searchSteps) && is_array($searchSteps)) {
                    foreach ($searchSteps as $sStep) {
                        $sQuery = trim($sStep['query'] ?? '');
                        if (!$sQuery) continue;
                        $comp = $row->data['company_name'] ?? $row->data['Unternehmen'] ?? $row->data['name'] ?? '';
                        $city = $row->data['city'] ?? $row->data['Stadt'] ?? '';
                        $domain = $row->data['domain'] ?? $row->data['website'] ?? '';
                        $rendered = str_replace(['{company_name}', '{city}', '{domain}'], [$comp, $city, $domain], $sQuery);
                        foreach ($row->data ?? [] as $k => $v) {
                            if (is_scalar($v)) $rendered = str_replace('{' . $k . '}', (string) $v, $rendered);
                        }
                        $rendered = trim($rendered);

                        $mode = $sStep['mode'] ?? 'search';
                        $depth = $sStep['depth'] ?? 'snippet';
                        $maxRes = min(10, max(1, (int) ($sStep['maxResults'] ?? 3)));

                        if ($mode === 'maps') {
                            $places = app(\App\Services\MapsService::class)->search($rendered, limit: $maxRes);
                            $lines = array_map(fn($p) => "- " . ($p['name'] ?? '') . " | " . ($p['address'] ?? '') . " | " . ($p['phone'] ?? '') . " | Rating: " . ($p['rating'] ?? '—'), $places);
                            if (!empty($lines)) {
                                $searchContextBlocks[] = "## Google Maps Treffer (" . ($sStep['label'] ?? $rendered) . "):\n" . implode("\n", $lines);
                            }
                        } elseif ($mode === 'scrape_url') {
                            $targetUrl = str_starts_with($rendered, 'http') ? $rendered : "https://{$rendered}";
                            try {
                                $sc = app(\App\Services\EdenAiService::class)->scrapeUrl($apiKey, $targetUrl);
                                if (!empty($sc['markdown'])) {
                                    $searchContextBlocks[] = "## Gecrawlte Seite ({$targetUrl}):\n" . substr($sc['markdown'], 0, 4000);
                                }
                            } catch (\Throwable $e) {}
                        } else {
                            $sRes = app(\App\Services\SearchService::class)->search($rendered, $maxRes);
                            $snippets = [];
                            foreach ($sRes['results'] ?? [] as $idx => $r) {
                                $snippets[] = "[" . ($idx + 1) . "] " . ($r['title'] ?? '') . " (" . ($r['url'] ?? '') . ")\n" . ($r['snippet'] ?? '');
                            }
                            if (!empty($snippets)) {
                                $searchContextBlocks[] = "## Suchergebnisse (" . ($sStep['label'] ?? $rendered) . "):\n" . implode("\n\n", $snippets);
                            }
                        }
                    }
                } elseif (!empty($column['useWebSearch'])) {
                    $rawSearchTemplate = !empty($column['searchQuery']) ? trim($column['searchQuery']) : '{company_name} {city}';
                    $renderedSearchQuery = $rawSearchTemplate;
                    $comp = $row->data['company_name'] ?? $row->data['Unternehmen'] ?? $row->data['name'] ?? '';
                    $city = $row->data['city'] ?? $row->data['Stadt'] ?? '';
                    $renderedSearchQuery = str_replace('{company_name}', $comp, $renderedSearchQuery);
                    $renderedSearchQuery = str_replace('{city}', $city, $renderedSearchQuery);
                    foreach ($row->data ?? [] as $k => $v) {
                        $renderedSearchQuery = str_replace('{' . $k . '}', (string) $v, $renderedSearchQuery);
                    }
                    $renderedSearchQuery = trim($renderedSearchQuery);
                    if (!empty($renderedSearchQuery)) {
                        try {
                            $searchRes = app(\App\Services\SearchService::class)->search($renderedSearchQuery, $column['searchMaxResults'] ?? 5);
                            $results = $searchRes['results'] ?? [];
                            if (!empty($results)) {
                                $snippets = [];
                                foreach ($results as $idx => $r) {
                                    $snippets[] = "[" . ($idx + 1) . "] " . ($r['title'] ?? '') . "\n" . ($r['snippet'] ?? '');
                                }
                                $searchContextBlocks[] = "## Web-Suchergebnisse für: {$renderedSearchQuery}\n\n" . implode("\n\n", $snippets);
                            }
                        } catch (\Throwable $e) {
                            // Proceed without web context on search failure
                        }
                    }
                }

                $webSearchContext = implode("\n\n---\n\n", $searchContextBlocks);

                $finalPrompt = $renderedPrompt ?: "Analysiere das Unternehmen: " . ($row->data['company_name'] ?? '');
                if ($webSearchContext) {
                    $finalPrompt = $webSearchContext . "\n\n---\n\n" . $finalPrompt;
                }

                $chat = app(\App\Services\EdenAiService::class)->chatCompletion(
                    apiKey: $apiKey,
                    model: $model,
                    system: 'Du bist ein KI-Assistent für Datenanreicherung. Antworte präzise.',
                    prompt: $finalPrompt,
                    maxTokens: 800,
                    temperature: 0.0,
                    region: $region
                );

                $val = trim($chat['raw'] ?? '');

                $row->refresh();
                $data = $row->data ?? [];
                $statuses = $row->cell_statuses ?? [];

                if (($column['outputMode'] ?? '') === 'json') {
                    $cleaned = preg_replace('/^```(?:json)?\s*/i', '', trim($val));
                    $cleaned = preg_replace('/\s*```$/', '', $cleaned);
                    $json = json_decode($cleaned, true);
                    if (is_array($json)) {
                        $jsonKey = $column['jsonKey'] ?? null;
                        $data[$outputKey] = ($jsonKey && isset($json[$jsonKey])) ? (is_string($json[$jsonKey]) ? $json[$jsonKey] : json_encode($json[$jsonKey])) : $val;
                    } else {
                        $data[$outputKey] = $val;
                    }
                } else {
                    $data[$outputKey] = $val;
                }

                // Speichere den exakten Prompt inkl. Web-Kontext & Raw-Output für volle Transparenz im Modal
                $data["_llm_prompt_{$outputKey}"] = $finalPrompt;
                $data["_llm_raw_{$outputKey}"] = $val;
                if (!empty($chat['tokens'])) {
                    $data["_llm_tokens_{$outputKey}"] = json_encode($chat['tokens']);
                }
                if (!empty($chat['cost_usd'])) {
                    $data["_llm_cost_{$outputKey}"] = (string) $chat['cost_usd'];
                }

                $statuses[$outputKey] = 'done';
                $row->update(['data' => $data, 'cell_statuses' => $statuses]);

                CaseLog::record($case->id, "✓ [{$colName}] {$company} — abgeschlossen");

                return response()->json([
                    'status' => 'done',
                    'row' => $row,
                    'result' => $data[$outputKey],
                    'renderedPrompt' => $finalPrompt,
                    'rawResponse' => $val,
                    'tokens' => $chat['tokens'] ?? null,
                    'costUsd' => $chat['cost_usd'] ?? null,
                ]);
            }
        } catch (Exception $e) {
            $row->refresh();
            $statuses = $row->cell_statuses ?? [];
            $statuses[$outputKey] = 'error';
            $errors = $row->cell_errors ?? [];
            $errors[$outputKey] = $e->getMessage();
            $row->update(['cell_statuses' => $statuses, 'cell_errors' => $errors]);

            CaseLog::record($case->id, "✗ [{$colName}] {$company} — Fehler: " . $e->getMessage());

            return response()->json([
                'status' => 'error',
                'error' => $e->getMessage(),
            ], 500);
        }
    }
}

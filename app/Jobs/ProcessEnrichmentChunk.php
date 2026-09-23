<?php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use App\Models\EnrichmentJob;
use App\Models\Row;
use App\Models\DataCase;
use App\Models\GlobalSetting;
use App\Models\CaseLog;
use App\Services\BatchEnrichService;
use App\Services\ContactSearchService;
use Illuminate\Support\Facades\DB;
use Exception;

class ProcessEnrichmentChunk implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 600; // 10 min per chunk
    public int $tries = 2;

    public function __construct(
        public string $jobId
    ) {}

    public function handle(
        BatchEnrichService $batchEnrich,
        ContactSearchService $contactSearch
    ): void {
        $job = EnrichmentJob::find($this->jobId);
        if (!$job || in_array($job->status, ['paused', 'cancelled', 'failed', 'completed'])) {
            return;
        }

        $case = DataCase::find($job->case_id);
        if (!$case) return;

        // Resolve API key
        $global = GlobalSetting::instance();
        $apiKey = $case->eden_api_key ?: ($global->eden_api_key ?: env('EDEN_API_KEY'));
        if (!$apiKey) {
            $job->update(['status' => 'failed', 'error' => 'No Eden API key configured']);
            return;
        }

        // Find column configuration
        $aiCols = $case->ai_columns ?? [];
        $column = null;
        foreach ($aiCols as $c) {
            if (($c['id'] ?? '') === $job->column_id || ($c['outputKey'] ?? '') === $job->column_id) {
                $column = $c;
                break;
            }
        }
        if (!$column) return;

        $outputKey = $column['outputKey'] ?? $job->column_id;
        $tool = $column['tool'] ?? $job->tool;
        $chunkSize = $job->config['chunk_size'] ?? 25;
        $runMode = $job->config['run_mode'] ?? 'empty_only';

        // Atomic row reservation using FOR UPDATE SKIP LOCKED
        $rows = DB::transaction(function () use ($job, $outputKey, $runMode, $chunkSize) {
            $query = Row::where('case_id', $job->case_id)
                ->where(function ($q) use ($outputKey) {
                    $q->whereNull("cell_statuses->{$outputKey}")
                      ->orWhere("cell_statuses->{$outputKey}", 'idle');
                });

            if ($runMode === 'empty_only') {
                $query->where(function ($q) use ($outputKey) {
                    $q->whereNull("data->{$outputKey}")
                      ->orWhere("data->{$outputKey}", '')
                      ->orWhereRaw("data->>? ILIKE 'notfound'", [$outputKey]);
                });
            }

            $selected = $query->orderBy('row_index', 'asc')
                ->limit($chunkSize)
                ->lockForUpdate()
                ->get();

            // Atomically mark running inside the lock
            foreach ($selected as $r) {
                $statuses = $r->cell_statuses ?? [];
                $statuses[$outputKey] = 'running';
                $r->update(['cell_statuses' => $statuses]);
            }

            return $selected;
        });

        if ($rows->isEmpty()) {
            // Check if entire job is completed
            $refreshed = DB::table('enrichment_jobs')->where('id', $this->jobId)->first();
            if ($refreshed && in_array($refreshed->status, ['running'])) {
                DB::table('enrichment_jobs')->where('id', $this->jobId)->update(['status' => 'completed']);
            }
            return;
        }

        foreach ($rows as $row) {
            // Re-check job cancellation between rows
            $currentStatus = DB::table('enrichment_jobs')->where('id', $this->jobId)->value('status');
            if (in_array($currentStatus, ['paused', 'cancelled'])) {
                break;
            }

            try {
                $region = $case->eden_region ?: ($global->eden_region ?: 'eu');
                $model = $column['model'] ?? ($region === 'eu' ? 'mistral/mistral-small-latest' : 'openai/gpt-4o-mini');

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

                    $data = $row->data ?? [];
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

                    $comp = $row->data['company_name'] ?? $row->data['name'] ?? ("Zeile #" . (($row->row_index ?? 0) + 1));
                    CaseLog::record($case->id, "✓ [{$column['name']}] {$comp} — {$summary}");
                } elseif ($tool === 'batch_company' || $tool === 'batch_enrich' || empty($tool) && empty($column['prompt'])) {
                    // Batch company
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

                    $data = array_merge($row->data ?? [], $result['fields'] ?? []);
                    $filled = count(array_filter($result['fields'] ?? []));
                    $summary = "{$filled}/" . count($fields) . " Felder angereichert";
                    $data[$outputKey] = $summary;
                    $data['_scrape_cached_ts'] = now()->toIso8601String();
                    $data['_scrape_origin'] = $result['source_origin'] ?? 'live:scrape';

                    $statuses[$outputKey] = 'done';
                    $row->update(['data' => $data, 'cell_statuses' => $statuses]);

                    $comp = $row->data['company_name'] ?? $row->data['name'] ?? ("Zeile #" . (($row->row_index ?? 0) + 1));
                    CaseLog::record($case->id, "✓ [{$column['name']}] {$comp} — {$summary}");
                } else {
                    // Custom prompt AI column
                    $promptTemplate = $column['prompt'] ?? '';
                    $renderedPrompt = $promptTemplate;
                    foreach ($row->data ?? [] as $k => $v) {
                        $renderedPrompt = str_replace('{' . $k . '}', (string) $v, $renderedPrompt);
                    }

                    // If useWebSearch is active, run web search with fallback
                    $webSearchContext = '';
                    if (!empty($column['useWebSearch'])) {
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
                                    $webSearchContext = "## Web-Suchergebnisse für: {$renderedSearchQuery}\n\n" . implode("\n\n", $snippets);
                                }
                            } catch (\Throwable $e) {
                                // Proceed without web context
                            }
                        }
                    }

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
                    $data = $row->data ?? [];

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

                    // Exakten Prompt und Output speichern für Transparenz
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

                    $comp = $row->data['company_name'] ?? $row->data['name'] ?? ("Zeile #" . (($row->row_index ?? 0) + 1));
                    CaseLog::record($case->id, "✓ [{$column['name']}] {$comp} — abgeschlossen");
                }

                // Increment job progress atomically
                DB::table('enrichment_jobs')->where('id', $this->jobId)->increment('processed_rows');
            } catch (Exception $e) {
                $statuses[$outputKey] = 'error';
                $errors = $row->cell_errors ?? [];
                $errors[$outputKey] = $e->getMessage();
                $row->update(['cell_statuses' => $statuses, 'cell_errors' => $errors]);

                $comp = $row->data['company_name'] ?? $row->data['name'] ?? ("Zeile #" . (($row->row_index ?? 0) + 1));
                CaseLog::record($case->id, "✗ [{$column['name']}] {$comp} — Fehler: " . $e->getMessage());

                DB::table('enrichment_jobs')->where('id', $this->jobId)->increment('failed_rows');
            }
        }

        // Check if entire job is completed or dispatch next chunk
        $refreshed = DB::table('enrichment_jobs')->where('id', $this->jobId)->first();
        if ($refreshed) {
            $totalDone = $refreshed->processed_rows + $refreshed->failed_rows;
            if ($totalDone >= $refreshed->total_rows) {
                DB::table('enrichment_jobs')->where('id', $this->jobId)->update(['status' => 'completed']);
            } elseif (empty($this->rowIds) && $refreshed->status === 'running') {
                // If using dynamic SKIP LOCKED mode, dispatch the next chunk
                self::dispatch($this->jobId);
            }
        }
    }
}

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
                if ($tool === 'batch_contact') {
                    $result = $contactSearch->searchContacts(
                        $row->data ?? [],
                        $apiKey,
                        $column['batchContactsMax'] ?? 3,
                        $column['model'] ?? 'openai/gpt-4o-mini'
                    );

                    $data = $row->data ?? [];
                    if (!empty($result['contacts'])) {
                        $data["_contacts_json_{$outputKey}"] = json_encode($result['contacts']);
                        $summary = count($result['contacts']) . ' Kontakte gefunden';
                    } else {
                        $summary = '—';
                    }
                    if (!empty($result['company_email'])) {
                        $data['company_email'] = $result['company_email'];
                    }

                    $statuses[$outputKey] = 'done';
                    $row->update(['data' => $data, 'cell_statuses' => $statuses]);
                } else {
                    // Default: batch_company
                    $fields = $column['batchOutputFields'] ?? ['company_name', 'domain', 'phone', 'company_email', 'address', 'city', 'zip', 'industry', 'description'];
                    $result = $batchEnrich->enrichRow($row->data ?? [], $apiKey, $fields, $column['model'] ?? 'openai/gpt-4o-mini');

                    $data = array_merge($row->data ?? [], $result['fields'] ?? []);
                    $filled = count(array_filter($result['fields'] ?? []));
                    $data[$outputKey] = "{$filled}/" . count($fields) . " Felder angereichert";

                    $statuses[$outputKey] = 'done';
                    $row->update(['data' => $data, 'cell_statuses' => $statuses]);
                }

                // Increment job progress atomically
                DB::table('enrichment_jobs')->where('id', $this->jobId)->increment('processed_rows');
            } catch (Exception $e) {
                $statuses[$outputKey] = 'error';
                $errors = $row->cell_errors ?? [];
                $errors[$outputKey] = $e->getMessage();
                $row->update(['cell_statuses' => $statuses, 'cell_errors' => $errors]);

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

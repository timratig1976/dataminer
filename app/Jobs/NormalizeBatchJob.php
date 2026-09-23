<?php

namespace App\Jobs;

use App\Models\ImportBatch;
use App\Services\RawImportNormalizerService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class NormalizeBatchJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 7200; // 2 hours max for huge 100k batches
    public int $tries = 2;

    public function __construct(
        public string $batchId,
        public ?string $apiKey = null,
        public string $region = 'us',
        public int $samplePercent = 100
    ) {}

    public function handle(RawImportNormalizerService $service): void
    {
        $batch = ImportBatch::find($this->batchId);
        if (!$batch) {
            Log::error("NormalizeBatchJob: Batch {$this->batchId} nicht gefunden.");
            return;
        }

        Log::info("NormalizeBatchJob gestartet für Batch {$this->batchId} ({$this->samplePercent}%)");
        $service->normalizeBatch($batch, $this->apiKey, $this->region, $this->samplePercent);
        Log::info("NormalizeBatchJob abgeschlossen für Batch {$this->batchId}");
    }
}

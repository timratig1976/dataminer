<?php

namespace App\Jobs;

use App\Models\DataCase;
use App\Services\RelevanceClassificationService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class ProcessRelevanceClassificationJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 7200; // 2 hours max for large datasets
    public int $tries = 1;

    public function __construct(
        public string $caseId,
        public ?string $customPrompt = null,
        public bool $reclassifyAll = false,
        public ?int $maxRows = null
    ) {}

    public function handle(RelevanceClassificationService $service): void
    {
        $case = DataCase::find($this->caseId);
        if (!$case) {
            Log::warning("[ProcessRelevanceClassificationJob] Case {$this->caseId} not found.");
            return;
        }

        try {
            $service->runFullClassification(
                caseId: $this->caseId,
                customPrompt: $this->customPrompt,
                reclassifyAll: $this->reclassifyAll,
                maxRows: $this->maxRows
            );
        } catch (\Throwable $e) {
            Log::error("[ProcessRelevanceClassificationJob] Error for case {$this->caseId}: " . $e->getMessage());
            $case->update([
                'relevance_status' => 'failed',
            ]);
        }
    }
}

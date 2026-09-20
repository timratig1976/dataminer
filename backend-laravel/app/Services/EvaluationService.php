<?php

namespace App\Services;

use App\Models\BatchEvaluationRun;
use App\Models\ImportBatch;
use App\Models\NormalizationPrompt;
use App\Models\RawImport;

class EvaluationService
{
    public function __construct(
        protected RawImportNormalizerService $normalizer
    ) {}

    /**
     * Run a sample evaluation (e.g. 10%) on an import batch and measure quality / hallucinations.
     */
    public function runSampleEvaluation(
        ImportBatch $batch,
        int $samplePercent = 10,
        ?string $promptId = null,
        ?string $apiKey = null,
        string $region = 'us'
    ): BatchEvaluationRun {
        $prompt = $promptId 
            ? NormalizationPrompt::find($promptId)
            : NormalizationPrompt::activeFor($batch->schema_type ?? '*')->first();

        $run = BatchEvaluationRun::create([
            'import_batch_id' => $batch->id,
            'prompt_id' => $prompt?->id,
            'sample_percent' => $samplePercent,
            'status' => 'running',
        ]);

        $startTime = microtime(true);

        // Normalize the sample subset
        $this->normalizer->normalizeBatch($batch, $apiKey, $region, $samplePercent, $prompt?->id);

        $durationMs = (int) round((microtime(true) - $startTime) * 1000);

        // Read all rows processed for this batch
        $processedRows = RawImport::where('import_batch_id', $batch->id)
            ->whereIn('status', ['normalized', 'error'])
            ->orderBy('source_row_index')
            ->get();

        $totalProcessed = $processedRows->count();
        $normalizedCount = 0;
        $errorCount = 0;
        $confSum = 0;
        $confHigh = 0;
        $confMid = 0;
        $confLow = 0;
        $allHallucinations = [];

        foreach ($processedRows as $row) {
            if ($row->status === 'normalized' && !empty($row->normalized_data)) {
                $normalizedCount++;
                $conf = (float) ($row->confidence_score ?? 0.7);
                $confSum += $conf;

                if ($conf >= 0.75) {
                    $confHigh++;
                } elseif ($conf >= 0.60) {
                    $confMid++;
                } else {
                    $confLow++;
                }

                $flags = $this->detectHallucinatedFields($row->normalized_data, $row->raw_data ?? []);
                foreach ($flags as $f) {
                    $allHallucinations[] = array_merge(['row_id' => $row->id, 'row_index' => $row->source_row_index + 1], $f);
                }
            } else {
                $errorCount++;
            }
        }

        $avgConf = $normalizedCount > 0 ? round($confSum / $normalizedCount, 3) : null;

        $run->update([
            'rows_processed' => $totalProcessed,
            'rows_normalized' => $normalizedCount,
            'rows_error' => $errorCount,
            'avg_confidence' => $avgConf,
            'conf_high_count' => $confHigh,
            'conf_mid_count' => $confMid,
            'conf_low_count' => $confLow,
            'hallucination_flags' => $allHallucinations,
            'duration_ms' => $durationMs,
            'status' => 'completed',
        ]);

        return $run->fresh();
    }

    /**
     * Check if any normalized value was invented out of thin air (not present in raw_data).
     */
    public function detectHallucinatedFields(array $normalizedData, array $rawData): array
    {
        $flags = [];

        // Flatten all non-empty raw strings into normalized search terms
        $rawSearchHaystack = [];
        foreach ($rawData as $val) {
            if ($val !== null && trim((string)$val) !== '') {
                $clean = strtolower(trim((string)$val));
                $rawSearchHaystack[] = $clean;
                // Also add version with all non-alphanumeric removed for phone/id matches
                $rawSearchHaystack[] = preg_replace('/[^a-z0-9]/', '', $clean);
            }
        }

        $fieldsToCheck = array_merge(
            $normalizedData['company_fields'] ?? [],
            $normalizedData['contact_fields'] ?? []
        );

        foreach ($fieldsToCheck as $field => $val) {
            if ($val === null || trim((string)$val) === '') continue;
            $valStr = trim((string)$val);

            // Skip generic short values or booleans
            if (strlen($valStr) < 2) continue;

            $needle = strtolower($valStr);
            $needleClean = preg_replace('/[^a-z0-9]/', '', $needle);

            $found = false;
            foreach ($rawSearchHaystack as $haystack) {
                if (empty($haystack)) continue;
                if (str_contains($haystack, $needle) || ($needleClean !== '' && str_contains($haystack, $needleClean))) {
                    $found = true;
                    break;
                }
            }

            if (!$found) {
                $flags[] = [
                    'field' => $field,
                    'invented_value' => $valStr,
                ];
            }
        }

        return $flags;
    }
}

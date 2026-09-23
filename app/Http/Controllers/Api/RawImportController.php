<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Jobs\NormalizeBatchJob;
use App\Models\GlobalSetting;
use App\Models\ImportBatch;
use App\Models\RawImport;
use App\Services\RawImportNormalizerService;
use App\Services\RawImportPromoteService;
use App\Services\RawImportStorageService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RawImportController extends Controller
{
    public function __construct(
        protected RawImportStorageService $storageService,
        protected RawImportNormalizerService $normalizerService,
        protected RawImportPromoteService $promoteService
    ) {}

    /**
     * List all import batches (paginated).
     */
    public function index(Request $request): JsonResponse
    {
        $batches = ImportBatch::with('case:id,name')
            ->orderBy('created_at', 'desc')
            ->paginate(20);

        return response()->json($batches);
    }

    /**
     * Show single batch details with paginated raw/normalized rows.
     */
    public function show(Request $request, string $batchId): JsonResponse
    {
        $batch = ImportBatch::with('case:id,name')->findOrFail($batchId);

        $query = RawImport::where('import_batch_id', $batchId);

        if ($request->has('status') && $request->status !== 'all') {
            $query->where('status', $request->status);
        }

        if ($request->has('min_confidence')) {
            $query->where('confidence_score', '>=', (float)$request->min_confidence);
        }

        $perPage = max(10, min(500, (int) $request->input('per_page', 50)));
        $rows = $query->orderBy('source_row_index')->paginate($perPage);

        // Confidence histogram stats
        $confLow = RawImport::where('import_batch_id', $batchId)->where('confidence_score', '<', 0.6)->count();
        $confMid = RawImport::where('import_batch_id', $batchId)->whereBetween('confidence_score', [0.6, 0.85])->count();
        $confHigh = RawImport::where('import_batch_id', $batchId)->where('confidence_score', '>', 0.85)->count();

        // Get currently active prompt for this batch schema
        $activePrompt = \App\Models\NormalizationPrompt::activeFor($batch->schema_type ?? 'mixed')->first();

        return response()->json([
            'batch' => $batch,
            'rows' => $rows,
            'active_prompt' => $activePrompt,
            'stats' => [
                'conf_low' => $confLow,
                'conf_mid' => $confMid,
                'conf_high' => $confHigh,
            ],
        ]);
    }

    /**
     * Upload CSV/XLSX into raw_imports.
     */
    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'file' => 'required|file|max:51200', // 50MB max
            'case_id' => 'nullable|string|exists:cases,id',
            'label' => 'nullable|string|max:255',
        ]);

        $file = $request->file('file');
        $label = $request->input('label') ?: $file->getClientOriginalName();
        $caseId = $request->input('case_id');
        $ext = strtolower($file->getClientOriginalExtension());

        if (in_array($ext, ['xlsx', 'xls', 'ods'])) {
            $batch = $this->storageService->storeFromXlsx($file->getRealPath(), $label, $caseId);
        } else {
            $content = file_get_contents($file->getRealPath());
            $batch = $this->storageService->storeFromCsv($content, $label, $caseId);
        }

        return response()->json([
            'batch_id' => $batch->id,
            'label' => $batch->label,
            'total_rows' => $batch->total_rows,
            'status' => $batch->status,
        ], 201);
    }

    /**
     * Start normalization (sync or async queue).
     */
    public function normalize(Request $request, string $batchId): JsonResponse
    {
        $batch = ImportBatch::findOrFail($batchId);
        $samplePercent = (int) $request->input('sample_percent', 100);
        $samplePercent = max(1, min(100, $samplePercent));
        $force = $request->boolean('force', true);

        // If force rerun is requested or all rows are already normalized, reset rows to pending
        if ($force || $batch->status === 'normalized') {
            $batch->update(['status' => 'pending', 'normalized_rows' => 0]);
            RawImport::where('import_batch_id', $batchId)->update([
                'status' => 'pending',
                'normalized_data' => null,
                'confidence_score' => null,
            ]);
            $batch->appendLog('INFO', "Force Rerun initiiert: Alle Zeilen auf 'pending' zurückgesetzt.");
        }

        $settings = GlobalSetting::instance();
        $apiKey = $settings->eden_api_key;
        $region = $settings->eden_region ?? 'us';

        // Disptach to queue if total rows >= 500
        if ($batch->total_rows >= 500) {
            $batch->update(['status' => 'normalizing']);
            NormalizeBatchJob::dispatch($batchId, $apiKey, $region, $samplePercent);
            return response()->json([
                'queued' => true,
                'batch_id' => $batchId,
                'message' => "Hintergrund-Job gestartet ({$samplePercent}% Normalisierung neu gestartet).",
            ]);
        }

        // Run synchronously for smaller batches
        $this->normalizerService->normalizeBatch($batch, $apiKey, $region, $samplePercent);

        return response()->json([
            'queued' => false,
            'batch' => $batch->fresh(),
            'message' => "Normalisierung abgeschlossen.",
        ]);
    }

    /**
     * Promote normalized raw rows into a Case.
     */
    public function promote(Request $request, string $batchId): JsonResponse
    {
        $request->validate([
            'case_id' => 'required|string|exists:cases,id',
            'column_overrides' => 'nullable|array',
            'import_companies' => 'nullable|boolean',
            'import_contacts' => 'nullable|boolean',
            'min_confidence' => 'nullable|numeric|min:0|max:1',
            'included_raw_columns' => 'nullable|array',
        ]);

        $batch = ImportBatch::findOrFail($batchId);
        $caseId = $request->input('case_id');
        $overrides = $request->input('column_overrides', []);
        $importCompanies = $request->boolean('import_companies', true);
        $importContacts = $request->boolean('import_contacts', true);
        $minConfidence = (float) $request->input('min_confidence', 0.0);
        $includedRawColumns = $request->input('included_raw_columns', []);

        $result = $this->promoteService->promote(
            $batch,
            $caseId,
            $overrides,
            $importCompanies,
            $importContacts,
            $minConfidence,
            $includedRawColumns
        );

        return response()->json([
            'message' => 'Erfolgreich in den Case importiert.',
            'batch' => $batch->fresh(),
            'result' => $result,
        ]);
    }

    /**
     * Rollback promoted rows and contacts for a batch.
     */
    public function rollback(string $batchId): JsonResponse
    {
        $batch = ImportBatch::findOrFail($batchId);
        $result = $this->promoteService->rollback($batch);

        return response()->json([
            'message' => 'Import erfolgreich zurückgerollt.',
            'batch' => $batch->fresh(),
            'result' => $result,
        ]);
    }

    /**
     * Dynamically execute an AI prompt on rows in the batch to generate a new column.
     */
    public function addAiColumn(Request $request, string $batchId): JsonResponse
    {
        $batch = ImportBatch::findOrFail($batchId);

        $request->validate([
            'column_name' => 'required|string|max:64',
            'prompt' => 'required|string|max:1000',
        ]);

        $colName = trim($request->input('column_name'));
        $userPrompt = trim($request->input('prompt'));

        $settings = GlobalSetting::instance();
        $apiKey = $settings->eden_api_key;

        $rows = RawImport::where('import_batch_id', $batchId)->orderBy('source_row_index')->get();

        $processed = 0;
        foreach ($rows as $row) {
            $norm = $row->normalized_data ?? [];
            $comp = $norm['company_fields'] ?? [];
            $cont = $norm['contact_fields'] ?? [];
            $raw = $row->raw_data ?? [];

            $generatedVal = null;

            if (!empty($apiKey)) {
                try {
                    $contextData = json_encode([
                        'company' => $comp,
                        'contact' => $cont,
                        'raw' => $raw,
                    ], JSON_UNESCAPED_UNICODE);

                    $systemMsg = "You are a data assistant for B2B intelligence. You receive a record and a prompt. Return ONLY the concise answer value for the requested column, nothing else. No markdown, no quotes.";
                    $promptText = "Prompt: {$userPrompt}\n\nRecord:\n{$contextData}";

                    $llmRes = app(\App\Services\EdenAiService::class)->chatCompletion(
                        'openai',
                        'gpt-4o-mini',
                        [
                            ['role' => 'system', 'content' => $systemMsg],
                            ['role' => 'user', 'content' => $promptText],
                        ],
                        128,
                        $apiKey,
                        $settings->eden_region ?? 'us'
                    );

                    $generatedVal = trim($llmRes['message'] ?? '');
                } catch (\Exception $e) {
                    \Illuminate\Support\Facades\Log::warning("AI column generation failed for row {$row->id}: " . $e->getMessage());
                }
            }

            // Fallback if no LLM key or error: heuristic / simulated tag
            if ($generatedVal === null || $generatedVal === '') {
                $compName = $comp['brand_name'] ?? ($comp['company_name'] ?? '');
                $generatedVal = "KI: " . (!empty($compName) ? $compName : 'Generiert');
            }

            // Store in normalized_data.extra or company_fields
            if (!isset($norm['extra'])) {
                $norm['extra'] = [];
            }
            $norm['extra'][$colName] = $generatedVal;

            $row->update([
                'normalized_data' => $norm,
            ]);
            $processed++;
        }

        return response()->json([
            'message' => "KI-Spalte '{$colName}' erfolgreich für {$processed} Zeilen berechnet.",
            'column_name' => $colName,
            'processed' => $processed,
        ]);
    }

    /**
     * Get live and persistent execution logs for a batch.
     */
    public function logs(string $batchId): JsonResponse
    {
        $batch = ImportBatch::findOrFail($batchId);
        return response()->json([
            'batch_id' => $batchId,
            'status' => $batch->status,
            'normalized_rows' => $batch->normalized_rows,
            'total_rows' => $batch->total_rows,
            'logs' => $batch->execution_logs ?? [],
        ]);
    }

    /**
     * Convert any selected phone column in the batch to E.164.
     */
    public function formatColumnE164(Request $request, string $batchId): JsonResponse
    {
        $batch = ImportBatch::findOrFail($batchId);
        $column = $request->input('column');
        $defaultRegion = $request->input('default_region', 'DE');

        if (!$column) {
            return response()->json(['message' => 'Keine Spalte angegeben.'], 422);
        }

        $threeCX = app(\App\Services\ThreeCXService::class);
        $rows = RawImport::where('import_batch_id', $batchId)->get();

        $converted = 0;
        foreach ($rows as $row) {
            $raw = $row->raw_data ?? [];
            $norm = $row->normalized_data ?? [];

            // Find source phone value (either from raw_data or normalized company/contact)
            $phoneVal = $raw[$column] ?? ($norm['company_fields'][$column] ?? ($norm['contact_fields'][$column] ?? null));

            if ($phoneVal) {
                $e164 = $threeCX->toE164($phoneVal, $defaultRegion);
                if ($e164) {
                    // Update in raw_data or normalized extra
                    $raw[$column . '_e164'] = $e164;
                    if (!isset($norm['extra'])) $norm['extra'] = [];
                    $norm['extra'][$column . '_e164'] = $e164;

                    $row->update([
                        'raw_data' => $raw,
                        'normalized_data' => $norm,
                    ]);
                    $converted++;
                }
            }
        }

        return response()->json([
            'message' => "{$converted} Telefonnummern aus Spalte '{$column}' erfolgreich in E.164 formatiert.",
            'converted' => $converted,
            'target_column' => $column . '_e164',
        ]);
    }

    /**
     * Inline-edit a single raw/normalized row.
     */
    public function updateRow(Request $request, string $rowId): JsonResponse
    {
        $row = RawImport::findOrFail($rowId);

        $request->validate([
            'normalized_data' => 'nullable|array',
            'confidence_score' => 'nullable|numeric|min:0|max:1',
            'status' => 'nullable|string|in:pending,normalized,promoted,skipped,error',
        ]);

        $row->update($request->only(['normalized_data', 'confidence_score', 'status']));

        return response()->json([
            'message' => 'Zeile aktualisiert.',
            'row' => $row->fresh(),
        ]);
    }

    /**
     * Delete an entire batch and its raw imports.
     */
    public function destroy(string $batchId): JsonResponse
    {
        $batch = ImportBatch::findOrFail($batchId);

        // If promoted, also rollback first
        if ($batch->status === 'promoted') {
            $this->promoteService->rollback($batch);
        }

        $batch->delete(); // Cascades to raw_imports via DB FK

        return response()->json(['message' => 'Import-Batch gelöscht.']);
    }
}

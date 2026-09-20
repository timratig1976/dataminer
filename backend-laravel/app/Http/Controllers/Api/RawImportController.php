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

        $rows = $query->orderBy('source_row_index')->paginate(50);

        // Confidence histogram stats
        $confLow = RawImport::where('import_batch_id', $batchId)->where('confidence_score', '<', 0.6)->count();
        $confMid = RawImport::where('import_batch_id', $batchId)->whereBetween('confidence_score', [0.6, 0.85])->count();
        $confHigh = RawImport::where('import_batch_id', $batchId)->where('confidence_score', '>', 0.85)->count();

        return response()->json([
            'batch' => $batch,
            'rows' => $rows,
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
                'message' => "Hintergrund-Job gestartet ({$samplePercent}% Normalisierung).",
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
        ]);

        $batch = ImportBatch::findOrFail($batchId);
        $caseId = $request->input('case_id');
        $overrides = $request->input('column_overrides', []);
        $importCompanies = $request->boolean('import_companies', true);
        $importContacts = $request->boolean('import_contacts', true);
        $minConfidence = (float) $request->input('min_confidence', 0.0);

        $result = $this->promoteService->promote(
            $batch,
            $caseId,
            $overrides,
            $importCompanies,
            $importContacts,
            $minConfidence
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

<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DataCase;
use App\Models\Row;
use App\Models\GlobalSetting;
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
        $tool = $column['tool'] ?? 'batch_company';

        // Set status to running
        $statuses = $row->cell_statuses ?? [];
        $statuses[$outputKey] = 'running';
        $row->update(['cell_statuses' => $statuses]);

        try {
            if ($tool === 'batch_contact') {
                $result = $contactSearch->searchContacts(
                    rowData: $row->data ?? [],
                    apiKey: $apiKey,
                    maxContacts: $column['batchContactsMax'] ?? 3,
                    includeLinkedIn: $column['batchContactsLinkedIn'] ?? true,
                    includeImpressum: $column['batchContactsImpressum'] ?? true,
                    model: $column['model'] ?? 'openai/gpt-4o-mini'
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
                $data[$outputKey] = $summary;

                $statuses[$outputKey] = 'done';
                $row->update(['data' => $data, 'cell_statuses' => $statuses]);

                return response()->json([
                    'status' => 'done',
                    'row' => $row,
                    'result' => $summary,
                ]);
            } else {
                // Default: batch_company
                $fields = $column['batchOutputFields'] ?? ['company_name', 'domain', 'phone', 'company_email', 'address', 'city', 'zip', 'industry', 'description'];
                $result = $batchEnrich->enrichRow($row->data ?? [], $apiKey, $fields, $column['model'] ?? 'openai/gpt-4o-mini');

                $data = array_merge($row->data ?? [], $result['fields'] ?? []);
                $filled = count(array_filter($result['fields'] ?? []));
                $summary = "{$filled}/" . count($fields) . " Felder angereichert";
                $data[$outputKey] = $summary;

                $statuses[$outputKey] = 'done';
                $row->update(['data' => $data, 'cell_statuses' => $statuses]);

                return response()->json([
                    'status' => 'done',
                    'row' => $row,
                    'result' => $summary,
                    'fields' => $result['fields'] ?? [],
                ]);
            }
        } catch (Exception $e) {
            $statuses[$outputKey] = 'error';
            $errors = $row->cell_errors ?? [];
            $errors[$outputKey] = $e->getMessage();
            $row->update(['cell_statuses' => $statuses, 'cell_errors' => $errors]);

            return response()->json([
                'status' => 'error',
                'error' => $e->getMessage(),
            ], 500);
        }
    }
}

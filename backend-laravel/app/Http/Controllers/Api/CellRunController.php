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
                    region: $region
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

                CaseLog::record($case->id, "✓ [{$colName}] {$company} — {$summary}");

                return response()->json([
                    'status' => 'done',
                    'row' => $row,
                    'result' => $summary,
                ]);
            } elseif ($tool === 'batch_company' || $tool === 'batch_enrich' || empty($tool) && empty($column['prompt'])) {
                $fields = $column['batchOutputFields'] ?? ['company_name', 'domain', 'phone', 'company_email', 'address', 'city', 'zip', 'industry', 'description'];
                $result = $batchEnrich->enrichRow(
                    rowData: $row->data ?? [],
                    apiKey: $apiKey,
                    requestedFields: $fields,
                    model: $model,
                    customSystemPrompt: !empty($column['prompt']) ? $column['prompt'] : null,
                    region: $region
                );

                $data = array_merge($row->data ?? [], $result['fields'] ?? []);
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

                $chat = app(\App\Services\EdenAiService::class)->chatCompletion(
                    apiKey: $apiKey,
                    model: $model,
                    system: 'Du bist ein KI-Assistent für Datenanreicherung. Antworte präzise.',
                    prompt: $renderedPrompt ?: "Analysiere das Unternehmen: " . ($row->data['company_name'] ?? ''),
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

                $statuses[$outputKey] = 'done';
                $row->update(['data' => $data, 'cell_statuses' => $statuses]);

                CaseLog::record($case->id, "✓ [{$colName}] {$company} — abgeschlossen");

                return response()->json([
                    'status' => 'done',
                    'row' => $row,
                    'result' => $data[$outputKey],
                ]);
            }
        } catch (Exception $e) {
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

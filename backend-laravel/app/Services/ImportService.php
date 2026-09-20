<?php

namespace App\Services;

use App\Models\DataCase;
use App\Models\Row;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\IOFactory;

class ImportService
{
    /**
     * Parse and import CSV content into a Case.
     * Handles large 100k files efficiently using chunked inserts.
     */
    public function importCsv(string $caseId, string $csvContent, ?array $columnMapping = null): array
    {
        $case = DataCase::findOrFail($caseId);

        $lines = preg_split('/\r\n|\r|\n/', trim($csvContent));
        if (empty($lines)) {
            return ['imported' => 0, 'headers' => []];
        }

        // Detect delimiter (comma vs semicolon vs tab)
        $firstLine = $lines[0];
        $delimiter = ',';
        if (substr_count($firstLine, ';') > substr_count($firstLine, ',')) {
            $delimiter = ';';
        } elseif (substr_count($firstLine, "\t") > substr_count($firstLine, ',')) {
            $delimiter = "\t";
        }

        $headers = str_getcsv(array_shift($lines), $delimiter);
        $headers = array_map('trim', $headers);

        $totalExisting = Row::where('case_id', $caseId)->count();
        $rowIndex = $totalExisting;

        $batch = [];
        $batchSize = 500;
        $importedCount = 0;

        foreach ($lines as $line) {
            if (empty(trim($line))) continue;

            $cells = str_getcsv($line, $delimiter);
            $rowData = [];

            foreach ($headers as $idx => $header) {
                if (empty($header)) continue;
                $key = $columnMapping[$header] ?? $header;
                $rowData[$key] = isset($cells[$idx]) ? trim($cells[$idx]) : null;
            }

            $batch[] = [
                'id' => (string) Str::uuid(),
                'case_id' => $caseId,
                'row_index' => $rowIndex++,
                'data' => json_encode($rowData),
                'cell_statuses' => json_encode([]),
                'cell_errors' => json_encode([]),
                'created_at' => now(),
                'updated_at' => now(),
            ];

            if (count($batch) >= $batchSize) {
                Row::insert($batch);
                $importedCount += count($batch);
                $batch = [];
            }
        }

        if (!empty($batch)) {
            Row::insert($batch);
            $importedCount += count($batch);
        }

        // Update case column schema if new columns are found
        $existingCols = $case->columns ?? [];
        $existingColKeys = array_column($existingCols, 'key');
        $updatedCols = $existingCols;

        foreach ($headers as $h) {
            if (!in_array($h, $existingColKeys) && !empty($h)) {
                $updatedCols[] = [
                    'id' => (string) Str::uuid(),
                    'key' => $h,
                    'label' => $h,
                    'type' => 'text',
                ];
            }
        }

        $case->update(['columns' => $updatedCols]);

        return [
            'imported' => $importedCount,
            'total_rows' => $rowIndex,
            'headers' => $headers,
        ];
    }

    /**
     * Parse and import an XLSX/ODS/XLS file into a Case.
     * Reads via PhpSpreadsheet, converts rows to same format as importCsv.
     */
    public function importXlsx(string $caseId, string $filePath, ?array $columnMapping = null): array
    {
        $case = DataCase::findOrFail($caseId);

        $spreadsheet = IOFactory::load($filePath);
        $sheet = $spreadsheet->getActiveSheet();
        $rows = $sheet->toArray(null, true, true, false);

        if (empty($rows)) {
            return ['imported' => 0, 'headers' => []];
        }

        // First row = headers
        $headers = array_map(fn($v) => trim((string) $v), array_shift($rows));
        $headers = array_filter($headers); // remove empty header cells

        $totalExisting = Row::where('case_id', $caseId)->count();
        $rowIndex = $totalExisting;
        $batch = [];
        $batchSize = 500;
        $importedCount = 0;

        foreach ($rows as $cells) {
            $rowData = [];
            foreach ($headers as $idx => $header) {
                $key = $columnMapping[$header] ?? $header;
                $val = $cells[$idx] ?? null;
                $rowData[$key] = $val !== null ? trim((string) $val) : null;
            }

            if (array_filter($rowData) === []) continue; // skip empty rows

            $batch[] = [
                'id' => (string) Str::uuid(),
                'case_id' => $caseId,
                'row_index' => $rowIndex++,
                'data' => json_encode($rowData),
                'cell_statuses' => json_encode([]),
                'cell_errors' => json_encode([]),
                'created_at' => now(),
                'updated_at' => now(),
            ];

            if (count($batch) >= $batchSize) {
                Row::insert($batch);
                $importedCount += count($batch);
                $batch = [];
            }
        }

        if (!empty($batch)) {
            Row::insert($batch);
            $importedCount += count($batch);
        }

        // Update case column schema
        $existingCols = $case->columns ?? [];
        $existingColKeys = array_column($existingCols, 'key');
        $updatedCols = $existingCols;
        foreach ($headers as $h) {
            if (!in_array($h, $existingColKeys) && !empty($h)) {
                $updatedCols[] = ['id' => (string) Str::uuid(), 'key' => $h, 'label' => $h, 'type' => 'text'];
            }
        }
        $case->update(['columns' => $updatedCols]);

        return [
            'imported' => $importedCount,
            'total_rows' => $rowIndex,
            'headers' => array_values($headers),
        ];
    }

    /**
     * Restore a complete Case and all its Rows from a JSON snapshot.
     */
    public function importSnapshot(array $snapshotData): DataCase
    {
        return DB::transaction(function () use ($snapshotData) {
            $caseData = $snapshotData['case'] ?? $snapshotData;
            $caseId = $caseData['id'] ?? (string) Str::uuid();

            // Support both camelCase (Next.js exporter) and snake_case
            $aiColumns = $caseData['ai_columns'] ?? $caseData['aiColumns'] ?? [];
            $colOrder = $caseData['col_order'] ?? $caseData['colOrder'] ?? [];
            $columns = $caseData['columns'] ?? [];

            // Upsert DataCase
            $case = DataCase::updateOrCreate(
                ['id' => $caseId],
                [
                    'name' => $caseData['name'] ?? 'Imported Snapshot',
                    'description' => $caseData['description'] ?? null,
                    'columns' => $columns,
                    'ai_columns' => $aiColumns,
                    'col_order' => $colOrder,
                ]
            );

            // Delete old rows if restoring existing case
            Row::where('case_id', $case->id)->delete();

            $rows = $snapshotData['rows'] ?? [];
            $batch = [];
            $batchSize = 500;

            foreach ($rows as $index => $r) {
                // Support both camelCase and snake_case for cellStatuses and row_index
                $cellStatuses = $r['cell_statuses'] ?? $r['cellStatuses'] ?? [];
                $cellErrors = $r['cell_errors'] ?? $r['cellErrors'] ?? [];
                $rowIndex = $r['row_index'] ?? $r['rowIndex'] ?? $index;
                $rowData = $r['data'] ?? [];

                // Smart status inference if snapshot had empty cellStatuses but enriched fields are present
                if (empty($cellStatuses) && is_array($rowData) && !empty($aiColumns)) {
                    foreach ($aiColumns as $ac) {
                        $tool = $ac['tool'] ?? '';
                        $outKey = $ac['outputKey'] ?? ($ac['key'] ?? '');
                        if (!$outKey) continue;

                        if ($tool === 'batch_company') {
                            $fields = $ac['batchOutputFields'] ?? ['company_name','domain','phone','company_email','city','industry','description'];
                            $hasAny = false;
                            foreach ($fields as $f) {
                                if (!empty($rowData[$f])) { $hasAny = true; break; }
                            }
                            if ($hasAny) {
                                $cellStatuses[$outKey] = 'done';
                            }
                        } elseif ($tool === 'batch_contact') {
                            $prefix = $ac['batchContactsPrefix'] ?? 'contact_';
                            $hasContact = !empty($rowData["_contacts_json_{$outKey}"]) 
                                || !empty($rowData["{$prefix}1_first_name"]) 
                                || !empty($rowData['contact_email'])
                                || !empty($rowData['first_name']);
                            if ($hasContact) {
                                $cellStatuses[$outKey] = 'done';
                            }
                        } else {
                            if (isset($rowData[$outKey]) && $rowData[$outKey] !== '' && $rowData[$outKey] !== null) {
                                $cellStatuses[$outKey] = 'done';
                            }
                        }
                    }
                }

                $batch[] = [
                    'id' => $r['id'] ?? (string) Str::uuid(),
                    'case_id' => $case->id,
                    'row_index' => $rowIndex,
                    'data' => json_encode($rowData),
                    'cell_statuses' => json_encode($cellStatuses),
                    'cell_errors' => json_encode($cellErrors),
                    'created_at' => now(),
                    'updated_at' => now(),
                ];

                if (count($batch) >= $batchSize) {
                    Row::insert($batch);
                    $batch = [];
                }
            }

            if (!empty($batch)) {
                Row::insert($batch);
            }

            return $case;
        });
    }
}

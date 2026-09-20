<?php

namespace App\Services;

use App\Models\ImportBatch;
use App\Models\RawImport;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\IOFactory;

class RawImportStorageService
{
    /**
     * Store raw CSV rows into raw_imports and create an ImportBatch.
     * Guaranteed immutable storage of original CSV data.
     */
    public function storeFromCsv(string $csvContent, string $label, ?string $caseId = null): ImportBatch
    {
        $lines = preg_split('/\r\n|\r|\n/', trim($csvContent));
        if (empty($lines)) {
            throw new \InvalidArgumentException("CSV-Inhalt ist leer.");
        }

        // Detect delimiter
        $firstLine = $lines[0];
        $delimiter = ',';
        if (substr_count($firstLine, ';') > substr_count($firstLine, ',')) {
            $delimiter = ';';
        } elseif (substr_count($firstLine, "\t") > substr_count($firstLine, ',')) {
            $delimiter = "\t";
        }

        $headers = str_getcsv(array_shift($lines), $delimiter);
        $headers = array_map('trim', $headers);

        $batchId = (string) Str::uuid();
        $batch = ImportBatch::create([
            'id' => $batchId,
            'label' => $label,
            'case_id' => $caseId,
            'status' => 'pending',
            'total_rows' => 0,
            'normalized_rows' => 0,
            'promoted_rows' => 0,
        ]);

        $chunk = [];
        $chunkSize = 500;
        $rowIndex = 0;
        $totalCount = 0;
        $now = now();

        foreach ($lines as $line) {
            if (empty(trim($line))) continue;

            $cells = str_getcsv($line, $delimiter);
            $rowData = [];
            foreach ($headers as $idx => $h) {
                if (empty($h)) continue;
                $rowData[$h] = isset($cells[$idx]) ? trim($cells[$idx]) : null;
            }

            $chunk[] = [
                'id' => (string) Str::uuid(),
                'import_batch_id' => $batchId,
                'case_id' => $caseId,
                'batch_label' => $label,
                'source_row_index' => $rowIndex++,
                'raw_data' => json_encode($rowData, JSON_UNESCAPED_UNICODE),
                'normalized_data' => null,
                'status' => 'pending',
                'confidence_score' => null,
                'ai_notes' => null,
                'schema_type' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ];
            $totalCount++;

            if (count($chunk) >= $chunkSize) {
                RawImport::insert($chunk);
                $chunk = [];
            }
        }

        if (!empty($chunk)) {
            RawImport::insert($chunk);
        }

        $batch->update(['total_rows' => $totalCount]);

        return $batch;
    }

    /**
     * Store from XLSX/XLS/ODS file into raw_imports.
     */
    public function storeFromXlsx(string $filePath, string $label, ?string $caseId = null): ImportBatch
    {
        $spreadsheet = IOFactory::load($filePath);
        $worksheet = $spreadsheet->getActiveSheet();
        $rows = $worksheet->toArray();

        if (empty($rows)) {
            throw new \InvalidArgumentException("Excel-Datei enthält keine Zeilen.");
        }

        $headers = array_shift($rows);
        $headers = array_map(fn($h) => trim((string)$h), $headers);

        $batchId = (string) Str::uuid();
        $batch = ImportBatch::create([
            'id' => $batchId,
            'label' => $label,
            'case_id' => $caseId,
            'status' => 'pending',
            'total_rows' => 0,
            'normalized_rows' => 0,
            'promoted_rows' => 0,
        ]);

        $chunk = [];
        $chunkSize = 500;
        $rowIndex = 0;
        $totalCount = 0;
        $now = now();

        foreach ($rows as $row) {
            $hasContent = false;
            foreach ($row as $c) {
                if ($c !== null && trim((string)$c) !== '') {
                    $hasContent = true;
                    break;
                }
            }
            if (!$hasContent) continue;

            $rowData = [];
            foreach ($headers as $idx => $h) {
                if (empty($h)) continue;
                $rowData[$h] = isset($row[$idx]) ? trim((string)$row[$idx]) : null;
            }

            $chunk[] = [
                'id' => (string) Str::uuid(),
                'import_batch_id' => $batchId,
                'case_id' => $caseId,
                'batch_label' => $label,
                'source_row_index' => $rowIndex++,
                'raw_data' => json_encode($rowData, JSON_UNESCAPED_UNICODE),
                'normalized_data' => null,
                'status' => 'pending',
                'confidence_score' => null,
                'ai_notes' => null,
                'schema_type' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ];
            $totalCount++;

            if (count($chunk) >= $chunkSize) {
                RawImport::insert($chunk);
                $chunk = [];
            }
        }

        if (!empty($chunk)) {
            RawImport::insert($chunk);
        }

        $batch->update(['total_rows' => $totalCount]);

        return $batch;
    }
}

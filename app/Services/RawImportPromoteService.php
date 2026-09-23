<?php

namespace App\Services;

use App\Models\ContactRow;
use App\Models\DataCase;
use App\Models\ImportBatch;
use App\Models\RawImport;
use App\Models\Row;
use Illuminate\Support\Str;

class RawImportPromoteService
{
    /**
     * Promote normalized raw_import rows into a DataCase (rows + contact_rows).
     *
     * @param ImportBatch $batch
     * @param string $caseId
     * @param array $columnOverrides (optional mapping overrides)
     * @param bool $importCompanies
     * @param bool $importContacts
     * @param float $minConfidence
     * @return array
     */
    public function promote(
        ImportBatch $batch,
        string $caseId,
        array $columnOverrides = [],
        bool $importCompanies = true,
        bool $importContacts = true,
        float $minConfidence = 0.0,
        array $includedRawColumns = []
    ): array {
        $case = DataCase::findOrFail($caseId);

        $rawRows = RawImport::where('import_batch_id', $batch->id)
            ->where('status', 'normalized')
            ->orderBy('source_row_index')
            ->get();

        if ($rawRows->isEmpty()) {
            throw new \RuntimeException("Keine normalisierten Zeilen in diesem Batch gefunden.");
        }

        $currentRowIndex = Row::where('case_id', $caseId)->count();
        $companiesCreated = 0;
        $contactsCreated = 0;

        // Group companies by domain or name to deduplicate parent company rows if needed
        $companyCache = []; // key (domain or name) => company_row_id

        foreach ($rawRows as $rawRow) {
            $conf = $rawRow->confidence_score ?? 1.0;
            if ($conf < $minConfidence) {
                $rawRow->update(['status' => 'skipped']);
                continue;
            }

            $norm = $rawRow->normalized_data ?? [];
            $compData = $norm['company_fields'] ?? [];
            $contData = $norm['contact_fields'] ?? [];
            $raw = $rawRow->raw_data ?? [];

            // Apply overrides if provided
            foreach ($columnOverrides as $target => $sourceVal) {
                if (isset($compData[$target])) $compData[$target] = $sourceVal;
                if (isset($contData[$target])) $contData[$target] = $sourceVal;
            }

            // Include explicit raw columns requested by user
            $selectedRawData = [];
            if (!empty($includedRawColumns)) {
                foreach ($includedRawColumns as $colKey) {
                    if (isset($raw[$colKey])) {
                        $selectedRawData[$colKey] = $raw[$colKey];
                    }
                }
            } else {
                // Default: Include all extra columns from normalization
                $selectedRawData = $norm['extra'] ?? [];
            }

            $companyRowId = null;

            // 1. Create Company Row if we have company data
            if ($importCompanies && !empty($compData)) {
                // Merge extra AI columns & selected raw data into company row
                $finalCompData = array_merge($compData, $selectedRawData);

                $dedupeKey = !empty($compData['domain']) ? strtolower($compData['domain']) : (!empty($compData['company_name']) ? strtolower($compData['company_name']) : null);

                if ($dedupeKey && isset($companyCache[$dedupeKey])) {
                    $companyRowId = $companyCache[$dedupeKey];
                } else {
                    $companyRowId = (string) Str::uuid();
                    Row::create([
                        'id' => $companyRowId,
                        'case_id' => $caseId,
                        'row_index' => $currentRowIndex++,
                        'data' => $finalCompData,
                        'cell_statuses' => [],
                        'cell_errors' => [],
                        'import_batch_id' => $batch->id,
                    ]);
                    $companiesCreated++;
                    if ($dedupeKey) {
                        $companyCache[$dedupeKey] = $companyRowId;
                    }
                }
            }

            // 2. Create Contact Row if we have contact data
            if ($importContacts && !empty($contData)) {
                // If contact row doesn't have company_name yet, pass it along
                if (!empty($compData['company_name']) && empty($contData['company'])) {
                    $contData['company'] = $compData['company_name'];
                }
                if (!empty($compData['domain']) && empty($contData['domain'])) {
                    $contData['domain'] = $compData['domain'];
                }

                ContactRow::create([
                    'id' => (string) Str::uuid(),
                    'case_id' => $caseId,
                    'company_row_id' => $companyRowId,
                    'row_index' => $contactsCreated,
                    'data' => $contData,
                    'cell_statuses' => [],
                    'cell_errors' => [],
                    'import_batch_id' => $batch->id,
                ]);
                $contactsCreated++;
            }

            $rawRow->update([
                'status' => 'promoted',
                'case_id' => $caseId,
            ]);
        }

        $batch->update([
            'status' => 'promoted',
            'case_id' => $caseId,
            'promoted_rows' => $companiesCreated + $contactsCreated,
        ]);

        return [
            'companies_created' => $companiesCreated,
            'contacts_created' => $contactsCreated,
            'total_promoted' => $companiesCreated + $contactsCreated,
        ];
    }

    /**
     * Rollback promoted rows and contacts for an ImportBatch.
     */
    public function rollback(ImportBatch $batch): array
    {
        $deletedCompanies = Row::where('import_batch_id', $batch->id)->delete();
        $deletedContacts = ContactRow::where('import_batch_id', $batch->id)->delete();

        // Reset raw rows back to normalized (ready to re-promote) or pending
        RawImport::where('import_batch_id', $batch->id)
            ->where('status', 'promoted')
            ->update([
                'status' => 'normalized',
                'case_id' => null,
            ]);

        $batch->update([
            'status' => 'normalized',
            'case_id' => null,
            'promoted_rows' => 0,
        ]);

        return [
            'companies_deleted' => $deletedCompanies,
            'contacts_deleted' => $deletedContacts,
        ];
    }
}

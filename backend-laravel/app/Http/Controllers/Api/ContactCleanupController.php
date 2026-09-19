<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ContactRow;
use App\Models\DataCase;
use App\Models\Row;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class ContactCleanupController extends Controller
{
    /**
     * Extract contact fields from company rows into contact_rows table and strip from rows.
     * POST /api/contact-rows/cleanup
     */
    public function cleanup(Request $request): JsonResponse
    {
        $caseId = $request->input('caseId');
        if (!$caseId) {
            return response()->json(['error' => 'caseId required'], 400);
        }

        $case = DataCase::findOrFail($caseId);
        $rows = Row::where('case_id', $case->id)->get();

        $totalInserted = 0;
        $totalCleaned = 0;

        foreach ($rows as $row) {
            $data = $row->data ?? [];
            $contacts = [];

            // 1. Check for _contacts_json_*
            foreach ($data as $k => $v) {
                if (str_starts_with($k, '_contacts_json_') && !empty($v)) {
                    $decoded = is_string($v) ? json_decode($v, true) : $v;
                    if (is_array($decoded)) {
                        $contacts = array_merge($contacts, $decoded);
                    }
                }
            }

            // 2. Check flat contact fields
            if (empty($contacts) && (!empty($data['first_name']) || !empty($data['last_name']))) {
                $contacts[] = [
                    'first_name' => $data['first_name'] ?? null,
                    'last_name' => $data['last_name'] ?? null,
                    'position' => $data['position'] ?? null,
                    'email' => $data['contact_email'] ?? null,
                    'phone' => $data['contact_phone'] ?? null,
                    'linkedin' => $data['linkedin'] ?? null,
                ];
            }

            // Upsert into contact_rows
            foreach ($contacts as $c) {
                if (empty($c['first_name']) && empty($c['last_name']) && empty($c['name'])) continue;
                ContactRow::updateOrCreate(
                    [
                        'case_id' => $case->id,
                        'company_row_id' => $row->id,
                        'email' => $c['email'] ?? null,
                    ],
                    [
                        'id' => (string) Str::uuid(),
                        'name' => $c['name'] ?? trim(($c['first_name'] ?? '') . ' ' . ($c['last_name'] ?? '')),
                        'first_name' => $c['first_name'] ?? null,
                        'last_name' => $c['last_name'] ?? null,
                        'position' => $c['position'] ?? null,
                        'phone' => $c['phone'] ?? null,
                        'linkedin' => $c['linkedin'] ?? null,
                        'data' => $c,
                    ]
                );
                $totalInserted++;
            }

            // Optional strip: clean large JSON debug blobs
            $cleanedData = $data;
            foreach (array_keys($cleanedData) as $dk) {
                if (str_starts_with($dk, '_contacts_impressum_') || str_starts_with($dk, '_contacts_google_')) {
                    unset($cleanedData[$dk]);
                }
            }
            if (count($cleanedData) !== count($data)) {
                $row->update(['data' => $cleanedData]);
                $totalCleaned++;
            }
        }

        return response()->json([
            'inserted' => $totalInserted,
            'rowsCleaned' => $totalCleaned,
            'message' => "{$totalInserted} Kontakte extrahiert und in den Kontakte-Tab überführt.",
        ]);
    }
}

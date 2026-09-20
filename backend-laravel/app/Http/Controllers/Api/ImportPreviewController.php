<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DataCase;
use App\Models\GlobalSetting;
use App\Services\EdenAiService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use PhpOffice\PhpSpreadsheet\IOFactory;

class ImportPreviewController extends Controller
{
    /**
     * Preview an uploaded CSV/XLSX file before final import.
     * POST /api/import/preview
     */
    public function preview(Request $request): JsonResponse
    {
        $request->validate([
            'file' => 'required|file|mimes:csv,txt,xlsx,xls,ods',
            'caseId' => 'nullable|string',
        ]);

        $file = $request->file('file');
        $ext = strtolower($file->getClientOriginalExtension());
        $path = $file->getRealPath();

        $headers = [];
        $rows = [];

        if (in_array($ext, ['xlsx', 'xls', 'ods'])) {
            $spreadsheet = IOFactory::load($path);
            $sheet = $spreadsheet->getActiveSheet();
            $data = $sheet->toArray(null, true, true, false);
            if (!empty($data)) {
                $headers = array_map(fn($v) => trim((string)$v), array_shift($data));
                $headers = array_values(array_filter($headers));
                foreach (array_slice($data, 0, 5) as $r) {
                    $rowObj = [];
                    foreach ($headers as $idx => $h) {
                        $rowObj[$h] = $r[$idx] ?? '';
                    }
                    $rows[] = $rowObj;
                }
            }
        } else {
            // CSV
            $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            if (!empty($lines)) {
                $first = $lines[0];
                $delim = substr_count($first, ';') > substr_count($first, ',') ? ';' : ',';
                $headers = str_getcsv(array_shift($lines), $delim);
                $headers = array_values(array_map('trim', array_filter($headers)));
                foreach (array_slice($lines, 0, 5) as $line) {
                    $cells = str_getcsv($line, $delim);
                    $rowObj = [];
                    foreach ($headers as $idx => $h) {
                        $rowObj[$h] = $cells[$idx] ?? '';
                    }
                    $rows[] = $rowObj;
                }
            }
        }

        return response()->json([
            'headers' => $headers,
            'previewRows' => $rows,
            'rowCount' => count($rows),
        ]);
    }

    /**
     * Suggest column mappings via LLM.
     * POST /api/import/llm-map
     */
    public function llmMap(Request $request, EdenAiService $edenAi): JsonResponse
    {
        $headers = $request->input('headers', []);
        if (empty($headers)) {
            return response()->json(['error' => 'headers required'], 400);
        }

        $global = GlobalSetting::instance();
        $apiKey = $global->eden_api_key ?: env('EDEN_API_KEY');

        if (!$apiKey) {
            // Deterministic fallback mapping
            $mapping = [];
            foreach ($headers as $h) {
                $lh = strtolower($h);
                if (str_contains($lh, 'firma') || str_contains($lh, 'name') || str_contains($lh, 'unternehmen')) $mapping[$h] = 'company_name';
                elseif (str_contains($lh, 'domain') || str_contains($lh, 'web') || str_contains($lh, 'site') || str_contains($lh, 'url')) $mapping[$h] = 'domain';
                elseif (str_contains($lh, 'mail')) $mapping[$h] = 'email';
                elseif (str_contains($lh, 'tel') || str_contains($lh, 'fon')) $mapping[$h] = 'phone';
                elseif (str_contains($lh, 'stadt') || str_contains($lh, 'ort') || str_contains($lh, 'city')) $mapping[$h] = 'city';
                elseif (str_contains($lh, 'plz') || str_contains($lh, 'zip')) $mapping[$h] = 'zip';
                elseif (str_contains($lh, 'stra') || str_contains($lh, 'adr')) $mapping[$h] = 'address';
                else $mapping[$h] = strtolower(preg_replace('/[^a-zA-Z0-9_]/', '_', $h));
            }
            return response()->json(['mapping' => $mapping, 'used' => false]);
        }

        try {
            $system = "Du bist ein Daten-Mapping-Assistent. Ordne Spalten den Zielfeldern zu (company_name, domain, phone, email, city, zip, address, industry, description). Antworte NUR als JSON: {\"header\": \"key\", ...}";
            $prompt = "Spalten: " . json_encode($headers);

            $res = $edenAi->chatCompletion($apiKey, 'openai/gpt-4o-mini', $system, $prompt);
            $raw = trim(preg_replace('/^```(?:json)?\n?/i', '', preg_replace('/\n?```$/i', '', $res['raw'])));
            $mapping = json_decode($raw, true) ?? [];

            return response()->json(['mapping' => $mapping, 'used' => true]);
        } catch (\Throwable $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }
}

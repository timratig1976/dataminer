<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DataCase;
use App\Models\GlobalSetting;
use App\Models\Row;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CatalogFlagController extends Controller
{
    /**
     * Flag or unflag a row as directory/catalog and learn its domain.
     * POST /api/cases/{id}/flag-catalog
     */
    public function flag(Request $request, string $id): JsonResponse
    {
        $validated = $request->validate([
            'rowId' => 'required|string',
            'flag' => 'nullable|boolean',
        ]);

        $case = DataCase::findOrFail($id);
        $row = Row::where('case_id', $case->id)->where('id', $validated['rowId'])->firstOrFail();

        $flag = $validated['flag'] ?? true;
        $data = $row->data ?? [];

        if ($flag) {
            $data['is_catalog'] = 'true';

            // Learn domain into global catalog domains
            $domain = $data['domain'] ?? $data['source_domain'] ?? '';
            if (!empty($domain)) {
                $clean = strtolower(trim(preg_replace('/^https?:\/\//', '', $domain)));
                $clean = preg_replace('/\/.*$/', '', $clean);
                $clean = preg_replace('/^www\./', '', $clean);

                $global = GlobalSetting::instance();
                $existing = $global->catalog_domains ?? [];
                if (!in_array($clean, $existing)) {
                    $existing[] = $clean;
                    $global->catalog_domains = $existing;
                    $global->save();
                }
            }
        } else {
            unset($data['is_catalog']);
        }

        $row->update(['data' => $data]);

        return response()->json([
            'ok' => true,
            'flag' => $flag,
            'row' => $row,
        ]);
    }
}

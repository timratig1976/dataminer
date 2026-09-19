<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DataCase;
use App\Models\Row;
use App\Services\EmailExtrapolatorService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class EmailExtrapolateController extends Controller
{
    /**
     * Generate email candidates for a contact row and store the best guess.
     * POST /api/cases/{id}/extrapolate-email
     */
    public function extrapolate(
        Request $request,
        string $id,
        EmailExtrapolatorService $extrapolator
    ): JsonResponse {
        $case = DataCase::findOrFail($id);
        $rowId = $request->input('rowId');

        if (!$rowId) {
            // Bulk-Modus: Alle Zeilen ohne contact_email aber mit Namen extrapolieren
            $rows = Row::where('case_id', $case->id)->get();
            $updatedCount = 0;

            foreach ($rows as $row) {
                $data = $row->data ?? [];
                $fn = $data['first_name'] ?? null;
                $ln = $data['last_name'] ?? null;
                $domain = $data['domain'] ?? $data['website'] ?? null;
                $existing = $data['contact_email'] ?? null;

                if (!empty($fn) && !empty($ln) && !empty($domain) && empty($existing)) {
                    $res = $extrapolator->extrapolate($fn, $ln, $domain);
                    if (!empty($res['best_guess'])) {
                        $data['contact_email'] = $res['best_guess'];
                        $data['email_extrapolated'] = 'true';
                        $row->update(['data' => $data]);
                        $updatedCount++;
                    }
                }
            }

            return response()->json([
                'success' => true,
                'updated' => $updatedCount,
                'message' => "{$updatedCount} E-Mail-Adressen extrapoliert.",
            ]);
        }

        // Einzelzeilen-Modus
        $row = Row::where('case_id', $case->id)->where('id', $rowId)->firstOrFail();
        $data = $row->data ?? [];

        $fn = $data['first_name'] ?? null;
        $ln = $data['last_name'] ?? null;
        $domain = $data['domain'] ?? $data['website'] ?? null;

        if (empty($fn) || empty($ln) || empty($domain)) {
            return response()->json(['error' => 'Vorname, Nachname und Domain erforderlich'], 400);
        }

        $res = $extrapolator->extrapolate($fn, $ln, $domain);
        if (!empty($res['best_guess'])) {
            $data['contact_email'] = $res['best_guess'];
            $data['email_extrapolated'] = 'true';
            $row->update(['data' => $data]);
        }

        return response()->json([
            'success' => true,
            'email' => $res['best_guess'],
            'candidates' => $res['candidates'],
            'confidence' => $res['confidence'],
        ]);
    }
}

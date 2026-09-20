<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ContactRow;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class ContactRowController extends Controller
{
    /**
     * List contacts for a case.
     * GET /api/contact-rows?caseId=...
     */
    public function index(Request $request): JsonResponse
    {
        $caseId = $request->query('caseId');
        if (!$caseId) {
            return response()->json(['error' => 'caseId required'], 400);
        }

        $contacts = ContactRow::where('case_id', $caseId)->get();
        $mapped = $contacts->map(function ($c) {
            $d = $c->data ?? [];
            return [
                'id' => $c->id,
                'company_row_id' => $c->company_row_id,
                'name' => $d['name'] ?? trim(($d['first_name'] ?? '') . ' ' . ($d['last_name'] ?? '')),
                'first_name' => $d['first_name'] ?? null,
                'last_name' => $d['last_name'] ?? null,
                'position' => $d['position'] ?? null,
                'email' => $d['email'] ?? null,
                'phone' => $d['phone'] ?? null,
                'linkedin' => $d['linkedin'] ?? null,
                'company_name' => $d['company_name'] ?? null,
                'domain' => $d['domain'] ?? null,
                'data' => $d,
            ];
        });

        return response()->json([
            'contacts' => $mapped,
            'total' => $mapped->count(),
        ]);
    }

    /**
     * Clear all contacts for a case.
     * DELETE /api/contact-rows?caseId=...
     */
    public function destroyByCase(Request $request): JsonResponse
    {
        $caseId = $request->query('caseId');
        if (!$caseId) {
            return response()->json(['error' => 'caseId required'], 400);
        }

        ContactRow::where('case_id', $caseId)->delete();
        return response()->json(['ok' => true]);
    }

    /**
     * Upsert contacts for a company row.
     * PATCH /api/contact-rows
     */
    public function upsert(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'caseId' => 'required|string',
            'companyRowId' => 'required|string',
            'contacts' => 'required|array',
        ]);

        $caseId = $validated['caseId'];
        $companyRowId = $validated['companyRowId'];
        $contacts = $validated['contacts'];

        $inserted = 0;
        foreach ($contacts as $c) {
            ContactRow::updateOrCreate(
                [
                    'case_id' => $caseId,
                    'company_row_id' => $companyRowId,
                    'email' => $c['email'] ?? null,
                ],
                [
                    'id' => (string) Str::uuid(),
                    'name' => $c['name'] ?? null,
                    'first_name' => $c['first_name'] ?? $c['firstname'] ?? null,
                    'last_name' => $c['last_name'] ?? $c['surname'] ?? null,
                    'position' => $c['position'] ?? $c['jobtitle'] ?? null,
                    'phone' => $c['phone'] ?? null,
                    'linkedin' => $c['linkedin'] ?? null,
                    'data' => $c,
                ]
            );
            $inserted++;
        }

        return response()->json([
            'ok' => true,
            'inserted' => $inserted,
        ]);
    }
}

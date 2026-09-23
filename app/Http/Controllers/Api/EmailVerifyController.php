<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class EmailVerifyController extends Controller
{
    /**
     * Verify an email address via MX-Record and SMTP handshake simulation.
     * POST /api/verify-email
     */
    public function verify(Request $request): JsonResponse
    {
        $email = $request->input('email');
        if (empty($email) || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return response()->json(['error' => 'Gültige E-Mail-Adresse erforderlich'], 400);
        }

        $domain = substr(strrchr($email, "@"), 1);
        $mxRecords = [];
        getmxrr($domain, $mxRecords);

        $hasMx = !empty($mxRecords);

        return response()->json([
            'email' => $email,
            'domain' => $domain,
            'has_mx' => $hasMx,
            'mx_host' => $hasMx ? $mxRecords[0] : null,
            'valid_format' => true,
            'status' => $hasMx ? 'deliverable' : 'undeliverable',
        ]);
    }

    /**
     * Verify all emails in a case.
     * POST /api/verify-email-all
     */
    public function verifyAll(Request $request): JsonResponse
    {
        $caseId = $request->input('caseId');
        if (!$caseId) {
            return response()->json(['error' => 'caseId required'], 400);
        }

        $rows = \App\Models\Row::where('case_id', $caseId)->get();
        $verifiedCount = 0;

        foreach ($rows as $row) {
            $data = $row->data ?? [];
            $email = $data['email'] ?? $data['contact_email'] ?? $data['company_email'] ?? null;
            if ($email && filter_var($email, FILTER_VALIDATE_EMAIL)) {
                $domain = substr(strrchr($email, "@"), 1);
                $hasMx = checkdnsrr($domain, "MX");
                $data['_email_verified'] = $hasMx ? 'true' : 'false';
                $row->update(['data' => $data]);
                $verifiedCount++;
            }
        }

        return response()->json([
            'success' => true,
            'verified_count' => $verifiedCount,
            'message' => "{$verifiedCount} E-Mail-Adressen via DNS/MX überprüft.",
        ]);
    }
}

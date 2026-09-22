<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\ThreeCXService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ThreeCXController extends Controller
{
    public function __construct(protected ThreeCXService $threeCXService)
    {
    }

    /**
     * POST /api/3cx/test-connection
     * Validates credentials and fetches token.
     */
    public function testConnection(Request $request): JsonResponse
    {
        $request->validate([
            'pbx_url' => 'required|string',
            'client_id' => 'required|string',
            'client_secret' => 'required|string',
        ]);

        try {
            $token = $this->threeCXService->getAccessToken(
                $request->input('pbx_url'),
                $request->input('client_id'),
                $request->input('client_secret')
            );

            return response()->json([
                'ok' => true,
                'message' => 'Verbindung zur 3CX XAPI erfolgreich hergestellt.',
                'token_preview' => substr($token, 0, 10) . '...',
            ]);
        } catch (\Throwable $e) {
            return response()->json([
                'ok' => false,
                'error' => $e->getMessage(),
            ], 400);
        }
    }

    /**
     * POST /api/3cx/fetch-contacts
     * Fetches all contacts from 3CX, checks formatting, and generates E.164 preview.
     */
    public function fetchContacts(Request $request): JsonResponse
    {
        $request->validate([
            'pbx_url' => 'required|string',
            'client_id' => 'required|string',
            'client_secret' => 'required|string',
            'default_region' => 'nullable|string|max:4',
        ]);

        $region = strtoupper($request->input('default_region', 'DE'));

        try {
            $token = $this->threeCXService->getAccessToken(
                $request->input('pbx_url'),
                $request->input('client_id'),
                $request->input('client_secret')
            );

            $contacts = $this->threeCXService->fetchAllContacts(
                $request->input('pbx_url'),
                $token,
                $region
            );

            $total = count($contacts);
            $needsUpdate = count(array_filter($contacts, fn($c) => $c['needs_update']));
            $hasInvalid = count(array_filter($contacts, fn($c) => $c['has_invalid']));
            $clean = $total - $needsUpdate - $hasInvalid;

            return response()->json([
                'ok' => true,
                'stats' => [
                    'total' => $total,
                    'needs_update' => $needsUpdate,
                    'has_invalid' => $hasInvalid,
                    'already_clean' => $clean,
                ],
                'contacts' => $contacts,
            ]);
        } catch (\Throwable $e) {
            return response()->json([
                'ok' => false,
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * POST /api/3cx/update-single
     * Updates one single contact in 3CX to E.164.
     */
    public function updateSingle(Request $request): JsonResponse
    {
        $request->validate([
            'pbx_url' => 'required|string',
            'client_id' => 'required|string',
            'client_secret' => 'required|string',
            'contact_id' => 'required',
            'phone' => 'nullable|string',
            'mobile' => 'nullable|string',
        ]);

        try {
            $token = $this->threeCXService->getAccessToken(
                $request->input('pbx_url'),
                $request->input('client_id'),
                $request->input('client_secret')
            );

            $payload = [];
            if ($request->has('phone')) {
                $payload['Phone'] = $request->input('phone');
            }
            if ($request->has('mobile')) {
                $payload['MobilePhone'] = $request->input('mobile');
            }

            $res = $this->threeCXService->updateContact(
                $request->input('pbx_url'),
                $token,
                $request->input('contact_id'),
                $payload
            );

            return response()->json([
                'ok' => true,
                'message' => 'Kontakt erfolgreich aktualisiert.',
                'result' => $res,
            ]);
        } catch (\Throwable $e) {
            return response()->json([
                'ok' => false,
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * POST /api/3cx/batch-update
     * Batch updates contacts to E.164.
     */
    public function batchUpdate(Request $request): JsonResponse
    {
        $request->validate([
            'pbx_url' => 'required|string',
            'client_id' => 'required|string',
            'client_secret' => 'required|string',
            'contacts' => 'required|array',
            'contacts.*.id' => 'required',
            'contacts.*.phone' => 'nullable|string',
            'contacts.*.mobile' => 'nullable|string',
        ]);

        $items = $request->input('contacts');
        $success = 0;
        $failed = 0;
        $errors = [];

        try {
            $token = $this->threeCXService->getAccessToken(
                $request->input('pbx_url'),
                $request->input('client_id'),
                $request->input('client_secret')
            );

            foreach ($items as $item) {
                $id = $item['id'];
                $payload = [];
                if (array_key_exists('phone', $item)) {
                    $payload['Phone'] = $item['phone'];
                }
                if (array_key_exists('mobile', $item)) {
                    $payload['MobilePhone'] = $item['mobile'];
                }

                if (empty($payload)) {
                    continue;
                }

                try {
                    $this->threeCXService->updateContact(
                        $request->input('pbx_url'),
                        $token,
                        $id,
                        $payload
                    );
                    $success++;
                } catch (\Throwable $e) {
                    $failed++;
                    $errors[] = [
                        'id' => $id,
                        'error' => $e->getMessage(),
                    ];
                }
            }

            return response()->json([
                'ok' => true,
                'success_count' => $success,
                'failed_count' => $failed,
                'errors' => array_slice($errors, 0, 20),
            ]);
        } catch (\Throwable $e) {
            return response()->json([
                'ok' => false,
                'error' => $e->getMessage(),
            ], 500);
        }
    }
}

<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;
use libphonenumber\PhoneNumberUtil;
use libphonenumber\PhoneNumberFormat;
use libphonenumber\NumberParseException;

class ThreeCXService
{
    protected PhoneNumberUtil $phoneUtil;

    public function __construct()
    {
        $this->phoneUtil = PhoneNumberUtil::getInstance();
    }

    /**
     * Format any raw phone number string to E.164 (e.g. "+491711234567").
     * Returns null if empty, invalid, or unparseable.
     */
    public function toE164(?string $raw, string $defaultRegion = 'DE'): ?string
    {
        if (!$raw || !trim((string)$raw)) {
            return null;
        }

        $cleaned = trim((string)$raw);
        // Fix German pattern like +49 (0) 171 -> +49 171
        $cleaned = preg_replace('/(\+\d{1,3})\s*\(0\)\s*/', '$1 ', $cleaned);

        try {
            $parsed = $this->phoneUtil->parse($cleaned, strtoupper($defaultRegion));
            if (!$this->phoneUtil->isValidNumber($parsed)) {
                return null;
            }
            return $this->phoneUtil->format($parsed, PhoneNumberFormat::E164);
        } catch (NumberParseException) {
            return null;
        }
    }

    /**
     * Obtain OAuth2 Client Credentials Bearer Token from 3CX.
     */
    public function getAccessToken(string $pbxUrl, string $clientId, string $clientSecret): string
    {
        $baseUrl = rtrim($pbxUrl, '/');
        $cacheKey = '3cx_token_' . md5($baseUrl . $clientId);

        if ($token = Cache::get($cacheKey)) {
            return $token;
        }

        $tokenUrl = "{$baseUrl}/connect/token";

        $response = Http::asForm()->timeout(15)->post($tokenUrl, [
            'client_id' => $clientId,
            'client_secret' => $clientSecret,
            'grant_type' => 'client_credentials',
        ]);

        if (!$response->successful()) {
            throw new \RuntimeException("3CX Token Fehler (HTTP {$response->status()}): " . $response->body());
        }

        $data = $response->json();
        $token = $data['access_token'] ?? null;
        if (!$token) {
            throw new \RuntimeException("3CX Token Response enthält keinen access_token: " . $response->body());
        }

        $expiresIn = max(60, ($data['expires_in'] ?? 3600) - 120);
        Cache::put($cacheKey, $token, $expiresIn);

        return $token;
    }

    /**
     * Fetch all contacts from 3CX XAPI (paginated with $top and $skip).
     */
    public function fetchAllContacts(string $pbxUrl, string $token, string $defaultRegion = 'DE'): array
    {
        $baseUrl = rtrim($pbxUrl, '/');
        $contactsUrl = "{$baseUrl}/xapi/v1/Contacts";

        $contacts = [];
        $skip = 0;
        $top = 500;

        while (true) {
            $response = Http::withHeaders([
                'Authorization' => "Bearer {$token}",
                'Content-Type' => 'application/json',
                'Accept' => 'application/json',
            ])->timeout(30)->get($contactsUrl, [
                '$top' => $top,
                '$skip' => $skip,
            ]);

            if (!$response->successful()) {
                throw new \RuntimeException("3CX Contacts Fehler (HTTP {$response->status()}): " . $response->body());
            }

            $json = $response->json();
            $rows = $json['value'] ?? [];
            if (empty($rows)) {
                break;
            }

            foreach ($rows as $c) {
                $id = $c['Id'] ?? $c['id'] ?? null;
                $fn = $c['FirstName'] ?? $c['firstName'] ?? '';
                $ln = $c['LastName'] ?? $c['lastName'] ?? '';
                $company = $c['CompanyName'] ?? $c['companyName'] ?? '';
                $rawPhone = $c['Phone'] ?? $c['phone'] ?? null;
                $rawMobile = $c['MobilePhone'] ?? $c['mobilePhone'] ?? null;

                $e164Phone = $this->toE164($rawPhone, $defaultRegion);
                $e164Mobile = $this->toE164($rawMobile, $defaultRegion);

                $phoneNeedsUpdate = ($rawPhone && $e164Phone && $rawPhone !== $e164Phone);
                $mobileNeedsUpdate = ($rawMobile && $e164Mobile && $rawMobile !== $e164Mobile);

                $phoneInvalid = ($rawPhone && !$e164Phone);
                $mobileInvalid = ($rawMobile && !$e164Mobile);

                $contacts[] = [
                    'id' => $id,
                    'first_name' => $fn,
                    'last_name' => $ln,
                    'company_name' => $company,
                    'raw_phone' => $rawPhone,
                    'e164_phone' => $e164Phone,
                    'raw_mobile' => $rawMobile,
                    'e164_mobile' => $e164Mobile,
                    'needs_update' => ($phoneNeedsUpdate || $mobileNeedsUpdate),
                    'has_invalid' => ($phoneInvalid || $mobileInvalid),
                    'original' => $c,
                ];
            }

            if (count($rows) < $top) {
                break;
            }

            $skip += $top;
        }

        return $contacts;
    }

    /**
     * Update an existing 3CX contact by ID via PATCH /xapi/v1/Contacts({Id}).
     */
    public function updateContact(string $pbxUrl, string $token, string|int $contactId, array $payload): array
    {
        $baseUrl = rtrim($pbxUrl, '/');
        $url = "{$baseUrl}/xapi/v1/Contacts({$contactId})";

        $response = Http::withHeaders([
            'Authorization' => "Bearer {$token}",
            'Content-Type' => 'application/json',
            'Accept' => 'application/json',
        ])->timeout(15)->patch($url, $payload);

        if (!$response->successful()) {
            throw new \RuntimeException("3CX PATCH Kontakt {$contactId} fehlgeschlagen (HTTP {$response->status()}): " . $response->body());
        }

        return $response->json() ?? ['status' => 'updated'];
    }

    /**
     * Create a new 3CX contact via POST /xapi/v1/Contacts.
     */
    public function createContact(string $pbxUrl, string $token, array $payload): array
    {
        $baseUrl = rtrim($pbxUrl, '/');
        $url = "{$baseUrl}/xapi/v1/Contacts";

        $response = Http::withHeaders([
            'Authorization' => "Bearer {$token}",
            'Content-Type' => 'application/json',
            'Accept' => 'application/json',
        ])->timeout(15)->post($url, $payload);

        if (!$response->successful()) {
            throw new \RuntimeException("3CX POST Kontakt fehlgeschlagen (HTTP {$response->status()}): " . $response->body());
        }

        return $response->json() ?? ['status' => 'created'];
    }
}

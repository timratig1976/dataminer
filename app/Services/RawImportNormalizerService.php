<?php

namespace App\Services;

use App\Models\ImportBatch;
use App\Models\NormalizationPrompt;
use App\Models\RawImport;
use Exception;
use Illuminate\Support\Facades\Log;

class RawImportNormalizerService
{
    public function __construct(
        protected EdenAiService $edenAi,
        protected ?ThreeCXService $threeCX = null
    ) {
        if (!$this->threeCX) {
            $this->threeCX = app(ThreeCXService::class);
        }
    }

    /**
     * Deterministic schema detection based on sample raw_data keys.
     */
    public function detectSchemaType(array $sampleRows): string
    {
        $hasContactFields = false;
        $hasCompanyFields = false;

        $contactKeys = ['first_name', 'last_name', 'vorname', 'nachname', 'ansprechpartner', 'kontakt', 'position', 'funktion', 'title', 'anrede'];
        $companyKeys = ['domain', 'website', 'web', 'unternehmensname', 'firma', 'firmenname', 'company', 'handelsregister', 'ust_id'];

        foreach ($sampleRows as $row) {
            $data = is_array($row) ? $row : ($row->raw_data ?? []);
            $keys = array_map(fn($k) => strtolower(trim((string)$k)), array_keys($data));

            foreach ($keys as $k) {
                foreach ($contactKeys as $ck) {
                    if (str_contains($k, $ck)) $hasContactFields = true;
                }
                foreach ($companyKeys as $ck) {
                    if (str_contains($k, $ck)) $hasCompanyFields = true;
                }
            }
        }

        if ($hasContactFields && !$hasCompanyFields) {
            return 'contact-first';
        }
        if ($hasCompanyFields && !$hasContactFields) {
            return 'company-first';
        }
        return 'mixed';
    }

    /**
     * Helper: Extract clean brand name and legal form from company name.
     */
    protected function cleanBrandAndLegalForm(string $rawCompanyName): array
    {
        $raw = trim($rawCompanyName);
        // Common legal forms
        $legalForms = [
            'GmbH & Co. KG', 'GmbH & Co. KGaA', 'GmbH & Co KG', 'GmbH', 'AG & Co. KG', 'AG', 
            'UG (haftungsbeschränkt)', 'UG haftungsbeschränkt', 'UG', 'e.K.', 'e. K.', 'e.V.',
            'KGaA', 'GbR', 'OHG', 'KG', 'LLC', 'Inc.', 'Ltd.', 'Corp.', 'SE & Co. KGaA', 'SE'
        ];

        $matchedForm = null;
        $brand = $raw;

        foreach ($legalForms as $form) {
            $pattern = '/\b' . preg_quote($form, '/') . '\b/i';
            if (preg_match($pattern, $raw)) {
                $matchedForm = $form;
                $brand = trim(preg_replace($pattern, '', $raw));
                // Remove trailing dashes, commas, dots
                $brand = trim($brand, " \t\n\r\0\x0B,-/|");
                break;
            }
        }

        return [
            'brand' => !empty($brand) ? $brand : $raw,
            'legal_form' => $matchedForm,
        ];
    }

    /**
     * Helper: Extract domain from URL or business email (excluding generic freemailers).
     */
    protected function extractCleanDomain(?string $url, ?string $email = null): ?string
    {
        if (!empty($url)) {
            $cleaned = preg_replace('#^https?://#i', '', trim($url));
            $cleaned = preg_replace('#^www\.#i', '', $cleaned);
            $parts = explode('/', $cleaned);
            $domain = strtolower(trim($parts[0]));
            if (filter_var('http://' . $domain, FILTER_VALIDATE_URL) || str_contains($domain, '.')) {
                return $domain;
            }
        }

        if (!empty($email) && str_contains($email, '@')) {
            $mailDomain = strtolower(trim(substr(strrchr($email, '@'), 1)));
            $freeMailers = [
                'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.de', 'hotmail.com', 
                'outlook.com', 'outlook.de', 'web.de', 'gmx.de', 'gmx.net', 't-online.de', 
                'freenet.de', 'icloud.com', 'me.com', 'aol.com', 'mail.de'
            ];
            if (!in_array($mailDomain, $freeMailers) && str_contains($mailDomain, '.')) {
                return $mailDomain;
            }
        }

        return null;
    }

    /**
     * Fallback deterministic normalization when no LLM key is available or on error.
     */
    public function deterministicNormalize(array $rawData): array
    {
        $companyFields = [];
        $contactFields = [];
        $extra = [];

        // Helper: Check exact key match or clean key check (ignoring prefixes/suffixes like "Opt-In", "Bestellsperre", "Verantwortlicher")
        foreach ($rawData as $rawKey => $val) {
            if ($val === null || trim((string)$val) === '') continue;
            $val = trim((string)$val);
            $k = strtolower($rawKey);

            // Skip boolean / permission opt-in keys from being mistaken for contact/company fields
            if (str_starts_with($k, 'opt-in') || str_contains($k, 'opt-in') || str_contains($k, 'sperre') || str_contains($k, 'verantwortlich') || str_contains($k, 'exporteur') || str_contains($k, 'art (')) {
                $extra[$rawKey] = $val;
                continue;
            }

            // 1. Contact Person specific fields (e.g. "Ansprechpartner-Vorname", "Ansprechpartner-Nachname")
            if (str_contains($k, 'ansprechpartner') || str_contains($k, 'kontaktadresse') || str_contains($k, 'kontakt')) {
                if (str_contains($k, 'vorname') && !isset($contactFields['first_name'])) {
                    $contactFields['first_name'] = $val;
                } elseif (str_contains($k, 'nachname') && !isset($contactFields['last_name'])) {
                    $contactFields['last_name'] = $val;
                } elseif (str_contains($k, 'titel') && !isset($contactFields['title'])) {
                    $contactFields['title'] = $val;
                } elseif (str_contains($k, 'anrede') && !isset($contactFields['salutation'])) {
                    $contactFields['salutation'] = $val;
                } elseif (str_contains($k, 'telefon') || str_contains($k, 'mobil')) {
                    if (str_contains($k, 'mobil')) {
                        $contactFields['mobile'] = $val;
                    } else {
                        $contactFields['phone_direct'] = $val;
                    }
                } elseif (str_contains($k, 'mail') || str_contains($k, 'email')) {
                    $contactFields['email'] = $val;
                } elseif ($k === 'ansprechpartner' || $k === 'kontakt') {
                    $parts = explode(' ', $val, 2);
                    if (empty($contactFields['first_name'])) $contactFields['first_name'] = $parts[0] ?? '';
                    if (empty($contactFields['last_name'])) $contactFields['last_name'] = $parts[1] ?? '';
                } else {
                    $extra[$rawKey] = $val;
                }
                continue;
            }

            // 2. Company fields
            if ($k === 'firma' || $k === 'company' || $k === 'firmenname' || $k === 'unternehmensname' || $k === 'company_name') {
                $companyFields['company_name'] = $val;
            } elseif ($k === 'firma-zusatz' || $k === 'firma zusatz') {
                $companyFields['company_name_addon'] = $val;
            } elseif ($k === 'website' || $k === 'domain' || $k === 'web' || $k === 'url' || $k === 'homepage') {
                $companyFields['website'] = $val;
            } elseif ($k === 'telefon' || $k === 'phone' || $k === 'tel' || $k === 'zentrale') {
                $companyFields['phone'] = $val;
            } elseif ($k === 'telefax' || $k === 'fax') {
                $companyFields['fax'] = $val;
            } elseif ($k === 'plz' || $k === 'postleitzahl' || $k === 'zip') {
                $companyFields['zip'] = $val;
            } elseif ($k === 'stadt' || $k === 'ort' || $k === 'city') {
                $companyFields['city'] = $val;
            } elseif ($k === 'land' || $k === 'country') {
                $companyFields['country'] = $val;
            } elseif ($k === 'strasse' || $k === 'straße' || $k === 'address' || $k === 'adresse') {
                $companyFields['address'] = $val;
            } elseif ($k === 'branche' || $k === 'industry' || $k === 'kategorie' || $k === 'sector') {
                $companyFields['industry'] = $val;
            } elseif ($k === 'beschreibung' || $k === 'description') {
                $companyFields['description'] = $val;
            } elseif ($k === 'e-mail' || $k === 'email' || $k === 'mail') {
                $companyFields['email'] = $val;
            // General contact fields if not already filled
            } elseif ($k === 'anrede' || $k === 'salutation') {
                $contactFields['salutation'] = $val;
            } elseif ($k === 'vorname' || $k === 'first_name') {
                $contactFields['first_name'] = $val;
            } elseif ($k === 'nachname' || $k === 'last_name') {
                $contactFields['last_name'] = $val;
            } elseif ($k === 'position' || $k === 'funktion' || $k === 'rolle' || $k === 'job') {
                $contactFields['position'] = $val;
            } elseif (str_contains($k, 'linkedin')) {
                $contactFields['linkedin'] = $val;
            } else {
                $extra[$rawKey] = $val;
            }
        }

        // Post-processing Company: Brand Extraction & Domain Resolver
        if (!empty($companyFields['company_name'])) {
            $brandInfo = $this->cleanBrandAndLegalForm($companyFields['company_name']);
            $companyFields['brand_name'] = $brandInfo['brand'];
            if (!empty($brandInfo['legal_form'])) {
                $companyFields['legal_form'] = $brandInfo['legal_form'];
            }
        }

        $detectedDomain = $this->extractCleanDomain(
            $companyFields['website'] ?? null, 
            $companyFields['email'] ?? ($contactFields['email'] ?? null)
        );
        if ($detectedDomain) {
            $companyFields['domain'] = $detectedDomain;
        }

        // Auto-Format phone numbers to E.164 if parseable
        if (!empty($companyFields['phone'])) {
            $e164 = $this->threeCX?->toE164($companyFields['phone'], 'DE');
            if ($e164) {
                $companyFields['phone_e164'] = $e164;
            }
        }
        if (!empty($contactFields['phone_direct'])) {
            $e164 = $this->threeCX?->toE164($contactFields['phone_direct'], 'DE');
            if ($e164) {
                $contactFields['phone_direct_e164'] = $e164;
            }
        }

        $hasComp = !empty($companyFields);
        $hasCont = !empty($contactFields);
        $confidence = ($hasComp && $hasCont) ? 0.90 : (($hasComp || $hasCont) ? 0.75 : 0.40);

        return [
            'company_fields' => $companyFields,
            'contact_fields' => $contactFields,
            'extra' => $extra,
            'confidence' => $confidence,
            'notes' => 'Company-First Pipeline angewendet (Brand/Domain/Contact/E.164 isoliert)',
        ];
    }

    /**
     * Normalize a batch of raw_imports using LLM (with deterministic fallback).
     *
     * @param ImportBatch $batch
     * @param string|null $apiKey
     * @param string $region
     * @param int $samplePercent (1-100)
     * @param string|null $promptId (optional explicit prompt ID)
     */
    public function normalizeBatch(
        ImportBatch $batch, 
        ?string $apiKey = null, 
        string $region = 'us', 
        int $samplePercent = 100,
        ?string $promptId = null
    ): void {
        $batch->update(['status' => 'normalizing']);
        $batch->appendLog('INFO', "Normalisierung gestartet ({$samplePercent}% Umfang)", [
            'sample_percent' => $samplePercent,
            'has_api_key' => !empty($apiKey),
        ]);

        $query = RawImport::where('import_batch_id', $batch->id)
            ->whereIn('status', ['pending', 'error'])
            ->orderBy('source_row_index');

        $totalPending = $query->count();
        if ($totalPending === 0) {
            $batch->update(['status' => 'normalized']);
            $batch->appendLog('INFO', 'Keine ausstehenden Zeilen mehr zu normalisieren.');
            return;
        }

        $limit = ($samplePercent < 100)
            ? max(1, (int) ceil($totalPending * ($samplePercent / 100)))
            : $totalPending;

        $rowsToProcess = $query->limit($limit)->get();

        // Detect schema type if not yet set
        if (empty($batch->schema_type)) {
            $sampleData = $rowsToProcess->take(15)->pluck('raw_data')->toArray();
            $detectedSchema = $this->detectSchemaType($sampleData);
            $batch->update(['schema_type' => $detectedSchema]);
            $batch->appendLog('INFO', "Schema-Typ automatisch erkannt: {$detectedSchema}");
        }
        $schemaType = $batch->schema_type ?? 'mixed';

        // Load Prompt from DB (or fallback to active wildcard)
        $promptModel = null;
        if (!empty($promptId)) {
            $promptModel = NormalizationPrompt::find($promptId);
        }
        if (!$promptModel) {
            $promptModel = NormalizationPrompt::activeFor($schemaType)->first();
        }

        if ($promptModel) {
            $batch->appendLog('INFO', "Verwende Normalisierungs-Prompt: '{$promptModel->name}' (v{$promptModel->version}) mit Modell {$promptModel->model}");
        }

        // Process in paginated cursor chunks to keep RAM footprint low (< 64MB)
        $chunkSize = $promptModel?->max_rows_per_chunk ?? 10;
        $totalChunks = (int) ceil($limit / $chunkSize);
        $chunkIndex = 1;
        $processedRows = 0;

        $query->limit($limit)->chunkById($chunkSize, function ($chunk) use (
            $apiKey, $region, $schemaType, $promptModel, $batch, $totalPending, $totalChunks, &$chunkIndex, &$processedRows
        ) {
            if (!empty($apiKey)) {
                try {
                    $this->normalizeChunkWithLlm($chunk, $schemaType, $apiKey, $region, $promptModel);
                    $processedRows += $chunk->count();
                    $batch->update(['normalized_rows' => $processedRows]);
                    if ($chunkIndex % 5 === 0 || $chunkIndex === $totalChunks) {
                        $batch->appendLog('SUCCESS', "Chunk {$chunkIndex}/{$totalChunks} ({$processedRows}/{$totalPending} Zeilen) via KI ({$promptModel?->model}) normalisiert.");
                    }
                    $chunkIndex++;
                    return;
                } catch (Exception $e) {
                    Log::warning("LLM Normalization failed for batch {$batch->id}, falling back to rule-based: " . $e->getMessage());
                    $batch->appendLog('WARN', "KI-Chunk {$chunkIndex} fehlgeschlagen, wechsle auf deterministisches Regel-Mapping", [
                        'error' => $e->getMessage(),
                    ]);
                }
            }

            // Fallback for this chunk
            foreach ($chunk as $row) {
                $result = $this->deterministicNormalize($row->raw_data ?? []);
                $row->update([
                    'normalized_data' => $result,
                    'status' => 'normalized',
                    'confidence_score' => $result['confidence'],
                    'ai_notes' => $result['notes'],
                    'schema_type' => $schemaType,
                ]);
            }
            $processedRows += $chunk->count();
            $batch->update(['normalized_rows' => $processedRows]);
            if ($chunkIndex % 25 === 0 || $chunkIndex === $totalChunks) {
                $batch->appendLog('INFO', "Chunk {$chunkIndex}/{$totalChunks} ({$processedRows}/{$totalPending} Zeilen) verarbeitet.");
            }
            $chunkIndex++;
        });

        $normalizedCount = RawImport::where('import_batch_id', $batch->id)
            ->where('status', 'normalized')
            ->count();

        $batch->update([
            'normalized_rows' => $normalizedCount,
            'status' => ($normalizedCount >= $batch->total_rows) ? 'normalized' : 'pending',
        ]);

        $batch->appendLog('SUCCESS', "Lauf abgeschlossen: {$normalizedCount} von {$batch->total_rows} Zeilen normalisiert.");
    }

    protected function normalizeChunkWithLlm(
        $rows, 
        string $schemaType, 
        string $apiKey, 
        string $region,
        ?NormalizationPrompt $promptModel = null
    ): void {
        $payload = [];
        foreach ($rows as $r) {
            $payload[] = [
                'id' => $r->id,
                'raw' => $r->raw_data,
            ];
        }

        $rowsJson = json_encode($payload, JSON_UNESCAPED_UNICODE);
        $rowsCount = count($rows);

        if ($promptModel) {
            $systemPrompt = str_replace(
                ['{{schema_type}}', '{{rows_count}}'],
                [$schemaType, (string)$rowsCount],
                $promptModel->system_prompt
            );
            $userPrompt = str_replace(
                ['{{rows}}', '{{rows_count}}', '{{schema_type}}'],
                [$rowsJson, (string)$rowsCount, $schemaType],
                $promptModel->user_prompt_template
            );
            $model = $promptModel->model ?? 'openai/gpt-4o';
            $maxTokens = $promptModel->max_tokens ?? 4000;
            $temp = $promptModel->temperature ?? 0.0;
        } else {
            // Default fallback if no DB prompt is active
            $systemPrompt = "Du bist ein präziser Daten-Normalisierungs-Assistent für B2B-Daten.\n"
                . "Schema-Typ: {$schemaType}.\n"
                . "TRENNE Rohdaten sauber in Firmen-Felder und Kontaktpersonen-Felder.\n"
                . "Erfinde NIEMALS Werte. Wenn ein Feld unklar ist, gib null zurück.\n"
                . "Antworte AUSSCHLIESSLICH als valides JSON-Array:\n"
                . "[{\"id\": \"...\", \"company_fields\": {...}, \"contact_fields\": {...}, \"extra\": {...}, \"confidence\": 0.95, \"notes\": \"...\"}]";
            $userPrompt = "Normalisiere diese Zeilen:\n" . $rowsJson;
            $model = 'openai/gpt-4o';
            $maxTokens = 4000;
            $temp = 0.0;
        }

        $response = $this->edenAi->chatCompletion(
            $apiKey,
            $model,
            $systemPrompt,
            $userPrompt,
            maxTokens: $maxTokens,
            temperature: $temp,
            region: $region
        );

        $rawText = $response['raw'] ?? '';
        $rawText = preg_replace('/^```(?:json)?\s*/i', '', trim($rawText));
        $rawText = preg_replace('/\s*```$/', '', $rawText);

        $results = json_decode($rawText, true);
        if (!is_array($results)) {
            throw new Exception("LLM returned non-JSON format: " . substr($rawText, 0, 150));
        }

        $indexedResults = [];
        foreach ($results as $res) {
            if (isset($res['id'])) {
                $indexedResults[$res['id']] = $res;
            }
        }

        foreach ($rows as $row) {
            if (isset($indexedResults[$row->id])) {
                $res = $indexedResults[$row->id];
                $conf = isset($res['confidence']) ? (float) $res['confidence'] : 0.8;
                $row->update([
                    'normalized_data' => [
                        'company_fields' => $res['company_fields'] ?? [],
                        'contact_fields' => $res['contact_fields'] ?? [],
                        'extra' => $res['extra'] ?? [],
                    ],
                    'status' => 'normalized',
                    'confidence_score' => $conf,
                    'ai_notes' => $res['notes'] ?? 'KI-Normalisierung erfolgreich',
                    'schema_type' => $schemaType,
                ]);
            } else {
                // Fallback for missing row in array
                $res = $this->deterministicNormalize($row->raw_data ?? []);
                $row->update([
                    'normalized_data' => $res,
                    'status' => 'normalized',
                    'confidence_score' => $res['confidence'],
                    'ai_notes' => $res['notes'],
                    'schema_type' => $schemaType,
                ]);
            }
        }
    }
}

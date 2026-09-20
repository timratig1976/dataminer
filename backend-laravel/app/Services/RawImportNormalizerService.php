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
        protected EdenAiService $edenAi
    ) {}

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
     * Fallback deterministic normalization when no LLM key is available or on error.
     */
    public function deterministicNormalize(array $rawData): array
    {
        $companyFields = [];
        $contactFields = [];
        $extra = [];

        foreach ($rawData as $rawKey => $val) {
            if ($val === null || trim((string)$val) === '') continue;
            $val = trim((string)$val);
            $k = strtolower($rawKey);

            // Company fields
            if (str_contains($k, 'firma') || str_contains($k, 'unternehmensname') || str_contains($k, 'company_name') || $k === 'company' || $k === 'name') {
                $companyFields['company_name'] = $val;
            } elseif (str_contains($k, 'domain') || str_contains($k, 'website') || str_contains($k, 'web') || str_contains($k, 'url')) {
                $domain = preg_replace('#^https?://#i', '', $val);
                $domain = explode('/', $domain)[0];
                $companyFields['domain'] = strtolower($domain);
            } elseif (str_contains($k, 'telefon') || str_contains($k, 'phone') || str_contains($k, 'tel')) {
                if (str_contains($k, 'durchwahl') || str_contains($k, 'mobil') || str_contains($k, 'direct')) {
                    $contactFields['phone_direct'] = $val;
                } else {
                    $companyFields['phone'] = $val;
                }
            } elseif (str_contains($k, 'plz') || str_contains($k, 'zip') || str_contains($k, 'postleitzahl')) {
                $companyFields['zip'] = $val;
            } elseif (str_contains($k, 'stadt') || str_contains($k, 'ort') || str_contains($k, 'city')) {
                $companyFields['city'] = $val;
            } elseif (str_contains($k, 'strasse') || str_contains($k, 'straße') || str_contains($k, 'address') || str_contains($k, 'adresse')) {
                $companyFields['address'] = $val;
            } elseif (str_contains($k, 'branche') || str_contains($k, 'industry') || str_contains($k, 'kategorie')) {
                $companyFields['industry'] = $val;
            } elseif (str_contains($k, 'beschreibung') || str_contains($k, 'description')) {
                $companyFields['description'] = $val;
            // Contact fields
            } elseif (str_contains($k, 'vorname') || str_contains($k, 'first_name') || str_contains($k, 'firstname')) {
                $contactFields['first_name'] = $val;
            } elseif (str_contains($k, 'nachname') || str_contains($k, 'last_name') || str_contains($k, 'lastname')) {
                $contactFields['last_name'] = $val;
            } elseif (str_contains($k, 'ansprechpartner') || str_contains($k, 'kontakt') || str_contains($k, 'contact_name')) {
                $parts = explode(' ', $val, 2);
                $contactFields['first_name'] = $parts[0] ?? '';
                $contactFields['last_name'] = $parts[1] ?? '';
            } elseif (str_contains($k, 'position') || str_contains($k, 'rolle') || str_contains($k, 'funktion') || str_contains($k, 'job')) {
                $contactFields['position'] = $val;
            } elseif (str_contains($k, 'linkedin')) {
                $contactFields['linkedin'] = $val;
            } elseif (str_contains($k, 'mail') || str_contains($k, 'email')) {
                if (str_contains($k, 'info') || str_contains($k, 'company') || str_contains($k, 'zentral')) {
                    $companyFields['email'] = $val;
                } else {
                    $contactFields['email'] = $val;
                }
            } else {
                $extra[$rawKey] = $val;
            }
        }

        $hasComp = !empty($companyFields);
        $hasCont = !empty($contactFields);
        $confidence = ($hasComp && $hasCont) ? 0.85 : (($hasComp || $hasCont) ? 0.70 : 0.40);

        return [
            'company_fields' => $companyFields,
            'contact_fields' => $contactFields,
            'extra' => $extra,
            'confidence' => $confidence,
            'notes' => 'Deterministisches Regel-Mapping angewendet',
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

        $query = RawImport::where('import_batch_id', $batch->id)
            ->whereIn('status', ['pending', 'error'])
            ->orderBy('source_row_index');

        $totalPending = $query->count();
        if ($totalPending === 0) {
            $batch->update(['status' => 'normalized']);
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

        $chunkSize = $promptModel?->max_rows_per_chunk ?? 10;
        $chunks = $rowsToProcess->chunk($chunkSize);

        foreach ($chunks as $chunk) {
            if (!empty($apiKey)) {
                try {
                    $this->normalizeChunkWithLlm($chunk, $schemaType, $apiKey, $region, $promptModel);
                    continue;
                } catch (Exception $e) {
                    Log::warning("LLM Normalization failed for batch {$batch->id}, falling back to rule-based: " . $e->getMessage());
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
        }

        $normalizedCount = RawImport::where('import_batch_id', $batch->id)
            ->where('status', 'normalized')
            ->count();

        $batch->update([
            'normalized_rows' => $normalizedCount,
            'status' => ($normalizedCount >= $batch->total_rows) ? 'normalized' : 'pending',
        ]);
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

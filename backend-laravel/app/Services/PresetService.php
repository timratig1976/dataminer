<?php

namespace App\Services;

class PresetService
{
    public static function getPresets(): array
    {
        return [
            [
                'name' => 'Official Domain',
                'outputKey' => 'official_domain',
                'model' => 'openai/gpt-4o-mini',
                'outputMode' => 'json',
                'jsonKey' => 'domain',
                'condition' => 'require_input',
                'conditionField' => 'company_name',
                'prompt' => 'Finde die offizielle primäre Domain für das gegebene Unternehmen (z.B. beispiel.de). Antworte als JSON: {"domain": "...", "confidence": "high|medium|low|notFound"}',
            ],
            [
                'name' => 'Industry Keywords',
                'outputKey' => 'industry_keywords',
                'model' => 'openai/gpt-4o-mini',
                'outputMode' => 'json',
                'jsonKey' => 'keywords',
                'condition' => 'require_input',
                'conditionField' => 'domain',
                'prompt' => 'Extrahiere die wichtigsten Branchen-Keywords von der Unternehmenswebseite. Antworte als JSON: {"keywords": ["...", "..."]}',
            ],
            [
                'name' => 'E-Mail',
                'outputKey' => 'email',
                'model' => 'openai/gpt-4o-mini',
                'outputMode' => 'text',
                'condition' => 'empty',
                'conditionField' => 'email',
                'prompt' => 'Finde die allgemeine geschäftliche E-Mail-Adresse für das Unternehmen. Antworte NUR mit der E-Mail oder "notFound".',
            ],
            [
                'name' => 'Telefon',
                'outputKey' => 'phone',
                'model' => 'openai/gpt-4o-mini',
                'outputMode' => 'text',
                'condition' => 'empty',
                'conditionField' => 'phone',
                'prompt' => 'Finde die offizielle Haupt-Telefonnummer des Betriebs im internationalen Format. Antworte NUR mit der Telefonnummer.',
            ],
            [
                'name' => 'LinkedIn (Firma)',
                'outputKey' => 'linkedin',
                'model' => 'openai/gpt-4o-mini',
                'outputMode' => 'text',
                'condition' => 'empty',
                'conditionField' => 'linkedin',
                'prompt' => 'Finde die offizielle LinkedIn-Unternehmensseite (https://www.linkedin.com/company/...). Antworte NUR mit der URL oder "notFound".',
            ],
            [
                'name' => 'Impressum / Firmendaten',
                'outputKey' => 'address',
                'model' => 'openai/gpt-4o-mini',
                'outputMode' => 'json',
                'condition' => 'empty',
                'conditionField' => 'address',
                'prompt' => 'Extrahiere die offiziellen Register- und Impressumsdaten des Unternehmens (legal_name, address, phone, email, managing_director, ust_id).',
            ],
            [
                'name' => '🚀 Firmendaten recherchieren',
                'outputKey' => '_batch_firmendaten',
                'model' => 'openai/gpt-4o-mini',
                'tool' => 'batch_company',
                'columnGroup' => 'company',
                'condition' => 'empty',
                'conditionField' => '_batch_firmendaten',
                'outputMode' => 'text',
                'batchOutputFields' => ['company_name', 'domain', 'phone', 'company_email', 'city', 'zip', 'industry', 'description', 'employees', 'founded'],
                'prompt' => '',
            ],
            [
                'name' => '👤 Entscheider finden',
                'outputKey' => '_batch_kontakte',
                'model' => 'openai/gpt-4o-mini',
                'tool' => 'batch_contact',
                'columnGroup' => 'contact',
                'condition' => 'empty',
                'conditionField' => '_batch_kontakte',
                'batchContactsMax' => 3,
                'batchContactsLinkedIn' => true,
                'batchContactsImpressum' => true,
                'outputMode' => 'text',
                'prompt' => '',
            ],
            [
                'name' => 'ViLocal Audit (GBP)',
                'outputKey' => 'vilocal_audit',
                'model' => 'openai/gpt-4o-mini',
                'outputMode' => 'json',
                'condition' => 'empty',
                'conditionField' => 'vilocal_audit',
                'prompt' => 'Analysiere das Google Business Profil des Unternehmens für den B2B-Pitch: Score 1-10, fehlende Elemente, Stärken, personalisierter Pitch-Hook.',
            ],
        ];
    }
}

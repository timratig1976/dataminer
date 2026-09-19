<?php

namespace App\Services;

use Illuminate\Support\Str;

class TemplateService
{
    public static function getTemplates(): array
    {
        return [
            [
                'id' => 'standard',
                'name' => 'Standard',
                'description' => 'Firmen- und Kontaktdaten anreichern. Startet mit Firmenname — zwei KI-Aktionen befüllen alle weiteren Felder.',
                'icon' => '⚡',
                'recommendedColumns' => ['company_name', 'maps_url'],
                'baseColumns' => [
                    ['name' => 'Firmenname', 'outputKey' => 'company_name'],
                    ['name' => 'Domain', 'outputKey' => 'domain'],
                    ['name' => 'Telefon', 'outputKey' => 'phone'],
                    ['name' => 'E-Mail (Firma)', 'outputKey' => 'company_email'],
                    ['name' => 'Adresse', 'outputKey' => 'address'],
                    ['name' => 'Stadt', 'outputKey' => 'city'],
                    ['name' => 'PLZ', 'outputKey' => 'zip'],
                    ['name' => 'Branche', 'outputKey' => 'industry'],
                    ['name' => 'Beschreibung', 'outputKey' => 'description'],
                    ['name' => 'Mitarbeiter', 'outputKey' => 'employees'],
                    ['name' => 'Gegründet', 'outputKey' => 'founded'],
                    ['name' => 'Maps URL', 'outputKey' => 'maps_url'],
                    ['name' => '★ Rating', 'outputKey' => 'maps_rating'],
                    ['name' => 'Kategorie', 'outputKey' => 'category'],
                    ['name' => 'Bewertungen', 'outputKey' => 'maps_reviews'],
                    ['name' => 'Vorname', 'outputKey' => 'first_name'],
                    ['name' => 'Nachname', 'outputKey' => 'last_name'],
                    ['name' => 'Position', 'outputKey' => 'position'],
                    ['name' => 'E-Mail (Kontakt)', 'outputKey' => 'contact_email'],
                    ['name' => 'LinkedIn', 'outputKey' => 'linkedin'],
                ],
                'aiColumns' => [
                    [
                        'id' => (string) Str::uuid(),
                        'name' => '🏢 Firmendaten',
                        'outputKey' => '_batch_firmendaten',
                        'prompt' => '',
                        'model' => 'openai/gpt-4o-mini',
                        'outputMode' => 'text',
                        'tool' => 'batch_company',
                        'batchOutputFields' => ['company_name', 'domain', 'phone', 'company_email', 'address', 'city', 'zip', 'industry', 'description', 'employees', 'founded'],
                        'batchSearchContacts' => false,
                        'condition' => 'empty',
                        'conditionField' => '_batch_firmendaten',
                        'columnGroup' => 'company',
                    ],
                    [
                        'id' => (string) Str::uuid(),
                        'name' => '👤 Entscheider',
                        'outputKey' => '_batch_kontakte',
                        'prompt' => '',
                        'model' => 'openai/gpt-4o-mini',
                        'outputMode' => 'text',
                        'tool' => 'batch_contact',
                        'batchContactsMax' => 3,
                        'batchContactsLinkedIn' => true,
                        'batchContactsImpressum' => true,
                        'batchContactsPrefix' => 'contact_',
                        'condition' => 'empty',
                        'conditionField' => '_batch_kontakte',
                        'columnGroup' => 'contact',
                    ],
                ],
            ],
            [
                'id' => 'vilocal',
                'name' => 'ViLocal Audit',
                'description' => 'Google Business Profile Analyse für B2B-Kaltakquise. Apify holt Maps-Daten frisch, KI bewertet GBP-Qualität, erkennt Ketten-Standorte und generiert personalisierten Pitch-Hook.',
                'icon' => '📍',
                'recommendedColumns' => ['company_name', 'maps_url'],
                'baseColumns' => [
                    ['name' => 'Domain', 'outputKey' => 'domain'],
                    ['name' => 'Firmenname', 'outputKey' => 'company_name'],
                    ['name' => 'Branche', 'outputKey' => 'industry'],
                    ['name' => 'Adresse', 'outputKey' => 'address'],
                    ['name' => 'PLZ', 'outputKey' => 'zip'],
                    ['name' => 'Stadt', 'outputKey' => 'city'],
                    ['name' => 'Beschreibung', 'outputKey' => 'description'],
                    ['name' => 'Telefon', 'outputKey' => 'phone'],
                    ['name' => 'E-Mail (Firma)', 'outputKey' => 'company_email'],
                    ['name' => 'Mitarbeiter', 'outputKey' => 'employees'],
                    ['name' => 'Gegründet', 'outputKey' => 'founded'],
                    ['name' => 'Maps URL', 'outputKey' => 'maps_url'],
                    ['name' => '★ Rating', 'outputKey' => 'maps_rating'],
                    ['name' => 'Kategorie', 'outputKey' => 'category'],
                ],
                'aiColumns' => [
                    [
                        'id' => (string) Str::uuid(),
                        'name' => '🏢 Firmendaten',
                        'outputKey' => '_batch_firmendaten',
                        'prompt' => '',
                        'model' => 'openai/gpt-4o-mini',
                        'outputMode' => 'text',
                        'tool' => 'batch_company',
                        'batchOutputFields' => ['company_name', 'domain', 'phone', 'company_email', 'address', 'city', 'zip', 'industry', 'description', 'employees', 'founded'],
                        'batchSearchContacts' => false,
                        'condition' => 'empty',
                        'conditionField' => '_batch_firmendaten',
                        'columnGroup' => 'company',
                    ],
                ],
            ],
            [
                'id' => 'none',
                'name' => 'Leeres Projekt',
                'description' => 'Startet ohne vordefinierte Spalten. Du kannst Spalten manuell anlegen oder per CSV-Upload importieren.',
                'icon' => '📄',
                'recommendedColumns' => [],
                'baseColumns' => [],
                'aiColumns' => [],
            ],
        ];
    }
}

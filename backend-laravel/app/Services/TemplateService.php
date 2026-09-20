<?php

namespace App\Services;

use App\Models\GlobalSetting;
use Illuminate\Support\Str;

class TemplateService
{
    public static function getTemplates(): array
    {
        $builtIn = [
            [
                'id' => 'standard',
                'name' => 'Standard Firmen-Recherche (Empfohlen)',
                'description' => 'Firmen- und Kontaktdaten anreichern. Zwei KI-Aktionen befüllen alle weiteren Felder (Firmendaten + Entscheider).',
                'icon' => '🏢',
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
                'id' => 'places',
                'name' => 'Google Maps / Local Places',
                'description' => 'Google Business Profile Analyse für lokale Akquise. Bewertet GBP-Qualität und extrahiert Maps-Daten.',
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
                'description' => 'Startet ohne vordefinierte Spalten für manuelle Konfiguration oder CSV-Upload.',
                'icon' => '📄',
                'recommendedColumns' => [],
                'baseColumns' => [],
                'aiColumns' => [],
            ],
        ];

        $settings = GlobalSetting::instance();
        $custom = $settings->custom_templates ?? [];

        return array_merge($builtIn, $custom);
    }

    public static function saveCaseAsTemplate(string $caseId, string $name, ?string $description = null): array
    {
        $case = \App\Models\DataCase::findOrFail($caseId);

        $baseCols = array_map(function ($c) {
            return [
                'name' => $c['label'] ?? $c['name'] ?? $c['key'],
                'outputKey' => $c['key'] ?? $c['outputKey'],
            ];
        }, $case->columns ?? []);

        $template = [
            'id' => 'custom_' . Str::slug($name) . '_' . Str::random(6),
            'name' => $name,
            'description' => $description ?: "Benutzerdefinierte Vorlage basierend auf Projekt {$case->name}",
            'icon' => '⭐',
            'recommendedColumns' => ['company_name', 'domain'],
            'baseColumns' => $baseCols,
            'aiColumns' => $case->ai_columns ?? [],
            'colOrder' => $case->col_order ?? [],
            'isCustom' => true,
            'createdAt' => now()->toIso8601String(),
        ];

        $settings = GlobalSetting::instance();
        $custom = $settings->custom_templates ?? [];
        $custom[] = $template;
        $settings->custom_templates = $custom;
        $settings->save();

        return $template;
    }
}

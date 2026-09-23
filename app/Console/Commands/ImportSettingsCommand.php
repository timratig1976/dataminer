<?php

namespace App\Console\Commands;

use App\Models\BlacklistDomain;
use App\Models\GlobalSetting;
use App\Models\NormalizationPrompt;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

class ImportSettingsCommand extends Command
{
    protected $signature = 'settings:import {--file=storage/app/settings-export.json : Pfad zur Importdatei} {--force : Überschreiben ohne Rückfrage}';
    protected $description = 'Importiert globale Einstellungen, Branding, Templates, Prompts und Blacklist (Cases bleiben unangetastet)';

    public function handle(): int
    {
        $filePath = base_path($this->option('file'));

        if (!file_exists($filePath)) {
            $this->error("Datei nicht gefunden: {$filePath}");
            return 1;
        }

        $content = file_get_contents($filePath);
        $data = json_decode($content, true);

        if (!$data || !isset($data['global_setting'])) {
            $this->error("Ungültiges Export-Format.");
            return 1;
        }

        if (!$this->option('force') && !$this->confirm("Möchtest du globale Einstellungen und Templates wirklich importieren? (Cases bleiben erhalten)")) {
            $this->info("Abgebrochen.");
            return 0;
        }

        $this->info("Importiere Einstellungen aus {$filePath}...");

        // 1. Global Settings
        $global = $data['global_setting'];
        $setting = GlobalSetting::instance();
        $setting->update([
            'eden_region' => $global['eden_region'] ?? $setting->eden_region,
            'model_allowlist' => $global['model_allowlist'] ?? $setting->model_allowlist,
            'catalog_domains' => $global['catalog_domains'] ?? $setting->catalog_domains,
            'planner_system_prompt' => $global['planner_system_prompt'] ?? $setting->planner_system_prompt,
            'custom_templates' => $global['custom_templates'] ?? $setting->custom_templates,
            'email_branding' => $global['email_branding'] ?? $setting->email_branding,
            'email_templates' => $global['email_templates'] ?? $setting->email_templates,
            'eden_api_key' => $global['eden_api_key'] ?? $setting->eden_api_key,
            'serper_api_key' => $global['serper_api_key'] ?? $setting->serper_api_key,
            'serp_api_key' => $global['serp_api_key'] ?? $setting->serp_api_key,
            'brave_api_key' => $global['brave_api_key'] ?? $setting->brave_api_key,
            'apify_api_token' => $global['apify_api_token'] ?? $setting->apify_api_token,
            'firecrawl_api_key' => $global['firecrawl_api_key'] ?? $setting->firecrawl_api_key,
        ]);
        $this->info("✓ GlobalSettings & E-Mail-Branding aktualisiert.");

        // 2. Normalization Prompts
        if (!empty($data['prompts']) && is_array($data['prompts'])) {
            foreach ($data['prompts'] as $p) {
                NormalizationPrompt::updateOrCreate(
                    [
                        'name' => $p['name'],
                        'version' => $p['version'] ?? 1,
                    ],
                    [
                        'id' => (string) Str::uuid(),
                        'description' => $p['description'] ?? null,
                        'schema_type' => $p['schema_type'] ?? '*',
                        'system_prompt' => $p['system_prompt'],
                        'user_prompt_template' => $p['user_prompt_template'],
                        'model' => $p['model'] ?? 'openai/gpt-4o',
                        'max_tokens' => $p['max_tokens'] ?? 4000,
                        'temperature' => $p['temperature'] ?? 0.0,
                        'max_rows_per_chunk' => $p['max_rows_per_chunk'] ?? 10,
                        'is_active' => $p['is_active'] ?? false,
                    ]
                );
            }
            $this->info("✓ " . count($data['prompts']) . " Prompts synchronisiert.");
        }

        // 3. Blacklist Domains
        if (!empty($data['blacklist']) && is_array($data['blacklist'])) {
            $inserted = 0;
            foreach ($data['blacklist'] as $b) {
                $domain = strtolower(trim($b['domain']));
                if (!$domain) continue;

                $existing = BlacklistDomain::where('domain', $domain)->first();
                if (!$existing) {
                    BlacklistDomain::create([
                        'id' => (string) Str::uuid(),
                        'domain' => $domain,
                        'reason' => $b['reason'] ?? 'Importiert',
                        'added_by' => $b['added_by'] ?? 'import',
                        'hit_count' => $b['hit_count'] ?? 0,
                    ]);
                    $inserted++;
                }
            }
            $this->info("✓ Blacklist Domains geprüft ({$inserted} neu hinzugefügt).");
        }

        $this->info("✓ Import erfolgreich beendet.");
        return 0;
    }
}

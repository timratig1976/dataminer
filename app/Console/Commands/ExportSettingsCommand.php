<?php

namespace App\Console\Commands;

use App\Models\BlacklistDomain;
use App\Models\GlobalSetting;
use App\Models\NormalizationPrompt;
use Illuminate\Console\Command;

class ExportSettingsCommand extends Command
{
    protected $signature = 'settings:export {--file=storage/app/settings-export.json : Pfad zur Zieldatei}';
    protected $description = 'Exportiert globale Einstellungen, E-Mail-Branding, Templates, Prompts und Blacklist (ohne Cases)';

    public function handle(): int
    {
        $filePath = base_path($this->option('file'));
        $this->info("Exportiere System-Einstellungen nach {$filePath}...");

        $setting = GlobalSetting::instance();
        $prompts = NormalizationPrompt::all();
        $blacklist = BlacklistDomain::all();

        $data = [
            'exported_at' => now()->toIso8601String(),
            'global_setting' => [
                'eden_region' => $setting->eden_region,
                'model_allowlist' => $setting->model_allowlist,
                'catalog_domains' => $setting->catalog_domains,
                'planner_system_prompt' => $setting->planner_system_prompt,
                'custom_templates' => $setting->custom_templates,
                'email_branding' => $setting->email_branding,
                'email_templates' => $setting->email_templates,
                // Decrypted API Keys for transfer
                'eden_api_key' => $setting->eden_api_key,
                'serper_api_key' => $setting->serper_api_key,
                'serp_api_key' => $setting->serp_api_key,
                'brave_api_key' => $setting->brave_api_key,
                'apify_api_token' => $setting->apify_api_token,
                'firecrawl_api_key' => $setting->firecrawl_api_key,
            ],
            'prompts' => $prompts->map(fn ($p) => [
                'name' => $p->name,
                'description' => $p->description,
                'schema_type' => $p->schema_type,
                'system_prompt' => $p->system_prompt,
                'user_prompt_template' => $p->user_prompt_template,
                'model' => $p->model,
                'max_tokens' => $p->max_tokens,
                'temperature' => $p->temperature,
                'max_rows_per_chunk' => $p->max_rows_per_chunk,
                'is_active' => $p->is_active,
                'version' => $p->version,
            ])->toArray(),
            'blacklist' => $blacklist->map(fn ($b) => [
                'domain' => $b->domain,
                'reason' => $b->reason,
                'added_by' => $b->added_by,
                'hit_count' => $b->hit_count,
            ])->toArray(),
        ];

        @mkdir(dirname($filePath), 0755, true);
        file_put_contents($filePath, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

        $this->info("✓ Export erfolgreich abgeschlossen! (" . count($data['prompts']) . " Prompts, " . count($data['blacklist']) . " Blacklist-Domains)");
        return 0;
    }
}

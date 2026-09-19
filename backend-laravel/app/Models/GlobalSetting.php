<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class GlobalSetting extends Model
{
    protected $table = 'settings';
    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = [
        'id',
        'eden_api_key',
        'eden_region',
        'model_allowlist',
        'catalog_domains',
        'serper_api_key',
        'serp_api_key',
        'brave_api_key',
        'apify_api_token',
        'firecrawl_api_key',
        'planner_system_prompt',
    ];

    protected $casts = [
        'model_allowlist' => 'array',
        'catalog_domains' => 'array',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
        // API-Keys werden verschlüsselt gespeichert (APP_KEY wird als Schlüssel verwendet)
        'eden_api_key' => 'encrypted',
        'serp_api_key' => 'encrypted',
        'serper_api_key' => 'encrypted',
        'brave_api_key' => 'encrypted',
        'apify_api_token' => 'encrypted',
        'firecrawl_api_key' => 'encrypted',
    ];

    public static function instance(): self
    {
        return self::firstOrCreate(
            ['id' => 'global'],
            [
                'eden_region' => 'us',
                'model_allowlist' => [],
                'catalog_domains' => [],
            ]
        );
    }
}

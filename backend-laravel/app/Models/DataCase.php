<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class DataCase extends Model
{
    protected $table = 'cases';
    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = [
        'id',
        'name',
        'ai_columns',
        'eden_api_key',
        'eden_region',
        'model_allowlist',
        'col_order',
    ];

    protected $casts = [
        'ai_columns' => 'array',
        'model_allowlist' => 'array',
        'col_order' => 'array',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    protected $appends = [
        'aiColumns',
        'colOrder',
        'edenApiKey',
        'edenRegion',
    ];

    public function getAiColumnsAttribute(): ?array
    {
        return $this->attributes['ai_columns'] ? json_decode($this->attributes['ai_columns'], true) : [];
    }

    public function getColOrderAttribute(): ?array
    {
        return $this->attributes['col_order'] ? json_decode($this->attributes['col_order'], true) : [];
    }

    public function getEdenApiKeyAttribute(): ?string
    {
        return $this->attributes['eden_api_key'] ?? null;
    }

    public function getEdenRegionAttribute(): ?string
    {
        return $this->attributes['eden_region'] ?? null;
    }

    public function rows(): HasMany
    {
        return $this->hasMany(Row::class, 'case_id')->orderBy('row_index', 'asc');
    }

    public function contactRows(): HasMany
    {
        return $this->hasMany(ContactRow::class, 'case_id');
    }
}

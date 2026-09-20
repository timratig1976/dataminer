<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

class NormalizationPrompt extends Model
{
    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = [
        'id',
        'name',
        'description',
        'schema_type',
        'system_prompt',
        'user_prompt_template',
        'model',
        'max_tokens',
        'temperature',
        'max_rows_per_chunk',
        'is_active',
        'version',
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'max_tokens' => 'integer',
        'temperature' => 'float',
        'max_rows_per_chunk' => 'integer',
        'version' => 'integer',
    ];

    protected static function booted(): void
    {
        static::creating(function ($model) {
            if (empty($model->id)) {
                $model->id = (string) Str::uuid();
            }
        });
    }

    public function evaluationRuns(): HasMany
    {
        return $this->hasMany(BatchEvaluationRun::class, 'prompt_id');
    }

    public function scopeActive(Builder $query): Builder
    {
        return $query->where('is_active', true);
    }

    public function scopeActiveFor(Builder $query, string $schemaType): Builder
    {
        return $query->where('is_active', true)
            ->where(function ($q) use ($schemaType) {
                $q->where('schema_type', $schemaType)
                  ->orWhere('schema_type', '*');
            })
            ->orderByRaw("CASE WHEN schema_type = ? THEN 0 ELSE 1 END", [$schemaType]);
    }
}

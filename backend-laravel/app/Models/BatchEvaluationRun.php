<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

class BatchEvaluationRun extends Model
{
    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = [
        'id',
        'import_batch_id',
        'prompt_id',
        'sample_percent',
        'rows_processed',
        'rows_normalized',
        'rows_error',
        'avg_confidence',
        'conf_high_count',
        'conf_mid_count',
        'conf_low_count',
        'hallucination_flags',
        'tokens_used',
        'cost_usd',
        'duration_ms',
        'status',
    ];

    protected $casts = [
        'sample_percent' => 'integer',
        'rows_processed' => 'integer',
        'rows_normalized' => 'integer',
        'rows_error' => 'integer',
        'avg_confidence' => 'float',
        'conf_high_count' => 'integer',
        'conf_mid_count' => 'integer',
        'conf_low_count' => 'integer',
        'hallucination_flags' => 'array',
        'tokens_used' => 'integer',
        'cost_usd' => 'float',
        'duration_ms' => 'integer',
    ];

    protected static function booted(): void
    {
        static::creating(function ($model) {
            if (empty($model->id)) {
                $model->id = (string) Str::uuid();
            }
        });
    }

    public function batch(): BelongsTo
    {
        return $this->belongsTo(ImportBatch::class, 'import_batch_id');
    }

    public function prompt(): BelongsTo
    {
        return $this->belongsTo(NormalizationPrompt::class, 'prompt_id');
    }
}

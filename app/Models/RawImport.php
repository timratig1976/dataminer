<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

class RawImport extends Model
{
    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = [
        'id',
        'import_batch_id',
        'case_id',
        'batch_label',
        'source_row_index',
        'raw_data',
        'normalized_data',
        'status',
        'confidence_score',
        'ai_notes',
        'schema_type',
    ];

    protected $casts = [
        'raw_data' => 'array',
        'normalized_data' => 'array',
        'confidence_score' => 'float',
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

    public function case(): BelongsTo
    {
        return $this->belongsTo(DataCase::class, 'case_id');
    }
}

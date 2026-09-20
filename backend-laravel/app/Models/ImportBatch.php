<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

class ImportBatch extends Model
{
    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = [
        'id',
        'label',
        'case_id',
        'status',
        'total_rows',
        'normalized_rows',
        'promoted_rows',
        'schema_type',
    ];

    protected static function booted(): void
    {
        static::creating(function ($model) {
            if (empty($model->id)) {
                $model->id = (string) Str::uuid();
            }
        });
    }

    public function rawImports(): HasMany
    {
        return $this->hasMany(RawImport::class, 'import_batch_id');
    }

    public function case(): BelongsTo
    {
        return $this->belongsTo(DataCase::class, 'case_id');
    }
}

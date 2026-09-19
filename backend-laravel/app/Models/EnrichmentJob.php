<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class EnrichmentJob extends Model
{
    protected $table = 'enrichment_jobs';
    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = [
        'id',
        'case_id',
        'column_id',
        'tool',
        'status',
        'total_rows',
        'processed_rows',
        'failed_rows',
        'error',
        'config',
    ];

    protected $casts = [
        'total_rows' => 'integer',
        'processed_rows' => 'integer',
        'failed_rows' => 'integer',
        'config' => 'array',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    public function dataCase(): BelongsTo
    {
        return $this->belongsTo(DataCase::class, 'case_id');
    }
}

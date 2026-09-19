<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ContactRow extends Model
{
    protected $table = 'contact_rows';
    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = [
        'id',
        'case_id',
        'company_row_id',
        'row_index',
        'data',
        'cell_statuses',
        'cell_errors',
    ];

    protected $casts = [
        'row_index' => 'integer',
        'data' => 'array',
        'cell_statuses' => 'array',
        'cell_errors' => 'array',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    public function dataCase(): BelongsTo
    {
        return $this->belongsTo(DataCase::class, 'case_id');
    }

    public function companyRow(): BelongsTo
    {
        return $this->belongsTo(Row::class, 'company_row_id');
    }
}

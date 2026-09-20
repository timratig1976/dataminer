<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Row extends Model
{
    protected $table = 'rows';
    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = [
        'id',
        'case_id',
        'row_index',
        'data',
        'cell_statuses',
        'cell_errors',
        'import_batch_id',
    ];

    protected $casts = [
        'row_index' => 'integer',
        'data' => 'array',
        'cell_statuses' => 'array',
        'cell_errors' => 'array',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    protected $appends = [
        'cellStatuses',
        'cellErrors',
        'rowIndex',
        'caseId',
    ];

    public function getCellStatusesAttribute(): ?array
    {
        return isset($this->attributes['cell_statuses']) && $this->attributes['cell_statuses']
            ? (is_string($this->attributes['cell_statuses']) ? json_decode($this->attributes['cell_statuses'], true) : $this->attributes['cell_statuses'])
            : [];
    }

    public function getCellErrorsAttribute(): ?array
    {
        return isset($this->attributes['cell_errors']) && $this->attributes['cell_errors']
            ? (is_string($this->attributes['cell_errors']) ? json_decode($this->attributes['cell_errors'], true) : $this->attributes['cell_errors'])
            : [];
    }

    public function getRowIndexAttribute(): ?int
    {
        return isset($this->attributes['row_index']) ? (int) $this->attributes['row_index'] : 0;
    }

    public function getCaseIdAttribute(): ?string
    {
        return $this->attributes['case_id'] ?? null;
    }

    public function dataCase(): BelongsTo
    {
        return $this->belongsTo(DataCase::class, 'case_id');
    }
}

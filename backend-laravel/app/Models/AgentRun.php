<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AgentRun extends Model
{
    protected $table = 'agent_runs';
    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = [
        'id',
        'case_id',
        'goal',
        'status',
        'state',
    ];

    protected $casts = [
        'goal' => 'array',
        'state' => 'array',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    protected $appends = [
        'caseId',
    ];

    public function getCaseIdAttribute(): ?string
    {
        return $this->attributes['case_id'] ?? null;
    }

    public function dataCase(): BelongsTo
    {
        return $this->belongsTo(DataCase::class, 'case_id');
    }
}

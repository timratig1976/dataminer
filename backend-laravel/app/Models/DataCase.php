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

    public function rows(): HasMany
    {
        return $this->hasMany(Row::class, 'case_id')->orderBy('row_index', 'asc');
    }

    public function contactRows(): HasMany
    {
        return $this->hasMany(ContactRow::class, 'case_id');
    }
}

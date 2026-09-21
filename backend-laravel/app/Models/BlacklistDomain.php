<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class BlacklistDomain extends Model
{
    use HasUuids;

    protected $table = 'blacklist_domains';

    protected $fillable = [
        'domain',
        'reason',
        'added_by',
        'hit_count',
    ];

    /**
     * Increment the hit count when a domain is blocked.
     */
    public function recordHit(): void
    {
        $this->increment('hit_count');
    }
}


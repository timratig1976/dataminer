<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ScrapeCache extends Model
{
    protected $table = 'scrape_cache';
    protected $primaryKey = 'url';
    public $incrementing = false;
    protected $keyType = 'string';
    public $timestamps = false;

    protected $fillable = [
        'url',
        'markdown',
        'title',
        'fetched_at',
    ];

    protected $casts = [
        'fetched_at' => 'datetime',
    ];

    public static function isFresh(string $url, int $ttlDays = 7): ?self
    {
        $cached = self::find($url);
        if (!$cached || !$cached->fetched_at) {
            return null;
        }

        if ($cached->fetched_at->diffInDays(now()) > $ttlDays) {
            return null;
        }

        return $cached;
    }
}

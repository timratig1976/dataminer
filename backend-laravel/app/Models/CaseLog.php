<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CaseLog extends Model
{
    protected $table = 'logs';
    public $timestamps = false;

    protected $fillable = [
        'case_id',
        'message',
        'created_at',
    ];

    protected $casts = [
        'created_at' => 'datetime',
    ];

    public static function record(string $caseId, string $message): self
    {
        return self::create([
            'case_id' => $caseId,
            'message' => $message,
            'created_at' => now(),
        ]);
    }
}

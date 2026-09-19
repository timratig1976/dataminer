<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Api\CaseController;
use App\Http\Controllers\Api\RowController;
use App\Http\Controllers\Api\ExportController;
use App\Http\Controllers\Api\EnrichmentJobController;

// Public or Authenticated routes via Sanctum
Route::middleware(['auth:sanctum'])->group(function () {
    // Current authenticated user profile & roles
    Route::get('/user', function (Request $request) {
        return $request->user()->load('roles', 'permissions');
    });

    // Read access for all authenticated roles (Super-Admin, Editor, Viewer)
    Route::get('/cases', [CaseController::class, 'index']);
    Route::get('/cases/{id}', [CaseController::class, 'show']);
    Route::get('/rows', [RowController::class, 'index']);
    Route::get('/export', [ExportController::class, 'exportCsv']);
    Route::get('/enrichment/jobs/{id}', [EnrichmentJobController::class, 'show']);
    Route::get('/enrichment/jobs/{id}/stream', [EnrichmentJobController::class, 'stream']);

    // Write access for Editor & Super-Admin
    Route::middleware(['role:Super-Admin|Editor'])->group(function () {
        Route::post('/cases', [CaseController::class, 'store']);
        Route::patch('/cases/{id}', [CaseController::class, 'update']);

        Route::post('/rows', [RowController::class, 'store']);
        Route::patch('/rows/{id}', [RowController::class, 'update']);

        Route::post('/enrichment/dispatch', [EnrichmentJobController::class, 'dispatchJob']);
        Route::post('/enrichment/jobs/{id}/cancel', [EnrichmentJobController::class, 'cancel']);
    });

    // Destructive access: Super-Admin only
    Route::middleware(['role:Super-Admin'])->group(function () {
        Route::delete('/cases/{id}', [CaseController::class, 'destroy']);
        Route::delete('/rows', [RowController::class, 'destroy']);
    });
});


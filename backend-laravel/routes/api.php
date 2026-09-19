<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Api\CaseController;
use App\Http\Controllers\Api\RowController;
use App\Http\Controllers\Api\ExportController;
use App\Http\Controllers\Api\EnrichmentJobController;
use App\Http\Controllers\Api\ImportController;
use App\Http\Controllers\Api\SettingsController;
use App\Http\Controllers\Api\AgentRunController;

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
    Route::get('/export/snapshot', [ExportController::class, 'exportSnapshot']);
    Route::get('/enrichment/jobs/{id}', [EnrichmentJobController::class, 'show']);
    Route::get('/enrichment/jobs/{id}/stream', [EnrichmentJobController::class, 'stream']);
    Route::get('/settings', [SettingsController::class, 'show']);
    Route::post('/settings/test-eden', [SettingsController::class, 'testEden']);
    Route::post('/settings/test-search', [SettingsController::class, 'testSearch']);
    Route::get('/agent/runs/{id}/stream', [AgentRunController::class, 'stream']);

    // Write access for Editor & Super-Admin
    Route::middleware(['role:Super-Admin|Editor'])->group(function () {
        Route::post('/cases', [CaseController::class, 'store']);
        Route::patch('/cases/{id}', [CaseController::class, 'update']);

        Route::post('/rows', [RowController::class, 'store']);
        Route::patch('/rows/{id}', [RowController::class, 'update']);

        Route::post('/enrichment/dispatch', [EnrichmentJobController::class, 'dispatchJob'])
            ->middleware('throttle:20,1'); // Max 20 Dispatches pro Minute pro User
        Route::post('/enrichment/jobs/{id}/cancel', [EnrichmentJobController::class, 'cancel']);

        Route::post('/import/csv', [ImportController::class, 'importCsv']);
        Route::post('/import/snapshot', [ImportController::class, 'importSnapshot']);
        Route::post('/import/xlsx', [ImportController::class, 'importXlsx']);

        Route::post('/agent/runs', [AgentRunController::class, 'store']);
        Route::post('/agent/runs/{id}/step', [AgentRunController::class, 'executeStep']);
    });

    // Destructive / Settings access: Super-Admin only
    Route::middleware(['role:Super-Admin'])->group(function () {
        Route::delete('/cases/{id}', [CaseController::class, 'destroy']);
        Route::delete('/rows', [RowController::class, 'destroy']);
        Route::put('/settings', [SettingsController::class, 'update']);
        Route::delete('/settings', [SettingsController::class, 'destroyKey']);
    });
});


<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Api\CaseController;
use App\Http\Controllers\Api\RowController;
use App\Http\Controllers\Api\ExportController;

Route::middleware(['auth:sanctum'])->get('/user', function (Request $request) {
    return $request->user()->load('roles', 'permissions');
});

// Cases API
Route::get('/cases', [CaseController::class, 'index']);
Route::get('/cases/{id}', [CaseController::class, 'show']);
Route::post('/cases', [CaseController::class, 'store']);
Route::patch('/cases/{id}', [CaseController::class, 'update']);
Route::delete('/cases/{id}', [CaseController::class, 'destroy']);

// Rows API
Route::get('/rows', [RowController::class, 'index']);
Route::post('/rows', [RowController::class, 'store']);
Route::patch('/rows/{id}', [RowController::class, 'update']);
Route::delete('/rows', [RowController::class, 'destroy']);

// Export API
Route::get('/export', [ExportController::class, 'exportCsv']);

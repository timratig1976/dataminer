<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\WebController;

Route::middleware(['auth'])->group(function () {
    Route::get('/', [WebController::class, 'dashboard'])->name('dashboard');
    Route::get('/cases', [WebController::class, 'cases'])->name('cases.index');
    Route::get('/cases/{id}', [WebController::class, 'caseDetail'])->name('cases.show');
    Route::get('/settings', [WebController::class, 'settings'])->name('settings');
});

require __DIR__.'/auth.php';

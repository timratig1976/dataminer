<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\WebController;

Route::middleware(['auth'])->group(function () {
    Route::get('/', [WebController::class, 'dashboard'])->name('dashboard');
    Route::get('/cases', [WebController::class, 'cases'])->name('cases.index');
    Route::get('/cases/{id}', [WebController::class, 'caseDetail'])->name('cases.show');
    Route::get('/settings', [WebController::class, 'settings'])->name('settings');
    Route::get('/settings/models', [WebController::class, 'modelsSettings'])->name('settings.models');
    Route::get('/settings/planner', [WebController::class, 'plannerSettings'])->name('settings.planner');
    Route::get('/settings/llm-test', [WebController::class, 'llmTestSettings'])->name('settings.llm-test');
    Route::get('/settings/users', [WebController::class, 'usersSettings'])->name('settings.users');
    Route::get('/settings/account', [WebController::class, 'accountSettings'])->name('settings.account');
    Route::get('/scrapling-test', [WebController::class, 'scraplingTest'])->name('scrapling.test');
});

require __DIR__.'/auth.php';

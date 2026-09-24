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
use App\Http\Controllers\Api\RawImportController;
use App\Http\Controllers\Api\NormalizationPromptController;
use App\Http\Controllers\Api\EvaluationController;

// Public or Authenticated routes via Sanctum or Session
Route::middleware(['web', 'auth'])->group(function () {
    // Current authenticated user profile & roles
    Route::get('/user', function (Request $request) {
        return $request->user()->load('roles', 'permissions');
    });

    // Read access for all authenticated roles (Super-Admin, Editor, Viewer)
    Route::get('/stats', [\App\Http\Controllers\Api\StatsController::class, 'index']);
    Route::get('/cases', [CaseController::class, 'index']);
    Route::get('/cases/templates', [CaseController::class, 'templates']);
    Route::get('/llm/models', [\App\Http\Controllers\Api\LlmTestController::class, 'models']);
    Route::post('/llm/smoke', [\App\Http\Controllers\Api\LlmTestController::class, 'smoke']);
    Route::post('/llm/compare', [\App\Http\Controllers\Api\LlmTestController::class, 'compare']);
    Route::get('/presets', function () {
        return response()->json(\App\Services\PresetService::getPresets());
    });
    Route::get('/templates', [\App\Http\Controllers\Api\TemplateController::class, 'index']);
    Route::post('/templates/from-case', [\App\Http\Controllers\Api\TemplateController::class, 'saveFromCase']);
    Route::delete('/templates/{id}', [\App\Http\Controllers\Api\TemplateController::class, 'destroy']);
    Route::get('/cases/{id}', [CaseController::class, 'show']);
    Route::post('/cases/{id}/plan', [\App\Http\Controllers\Api\CaseDiscoveryController::class, 'plan']);
    Route::post('/cases/{id}/discover', [\App\Http\Controllers\Api\CaseDiscoveryController::class, 'discover']);
    Route::post('/cases/{id}/append', [\App\Http\Controllers\Api\CaseDiscoveryController::class, 'append']);
    Route::post('/cases/{id}/add-column', [\App\Http\Controllers\Api\CaseDiscoveryController::class, 'addColumn']);
    Route::post('/cases/{id}/delete-column', [\App\Http\Controllers\Api\CaseDiscoveryController::class, 'deleteColumn']);
    Route::get('/cases/{id}/agent', [AgentRunController::class, 'indexForCase']);
    Route::get('/cases/{id}/agent/check-keys', [\App\Http\Controllers\Api\DiscoverySearchController::class, 'checkKeys']);
    Route::get('/cases/{id}/costs', [\App\Http\Controllers\Api\CaseCostController::class, 'show']);
    Route::get('/rows', [RowController::class, 'index']);
    Route::get('/rows/grouped', [\App\Http\Controllers\Api\GroupedRowsController::class, 'index']);
    Route::get('/contact-rows', [\App\Http\Controllers\Api\ContactRowController::class, 'index']);
    Route::get('/cache', [\App\Http\Controllers\Api\CacheController::class, 'index']);
    Route::match(['get', 'post'], '/discovery/search', [\App\Http\Controllers\Api\DiscoverySearchController::class, 'search']);
    Route::post('/search/debug', [\App\Http\Controllers\Api\SearchDebugController::class, 'debug']);
    Route::get('/logs', [\App\Http\Controllers\Api\LogController::class, 'index']);
    Route::delete('/logs', [\App\Http\Controllers\Api\LogController::class, 'destroy']);
    Route::get('/export', [ExportController::class, 'exportCsv']);
    Route::get('/export/snapshot', [ExportController::class, 'exportSnapshot']);
    Route::get('/enrichment/jobs/{id}', [EnrichmentJobController::class, 'show']);
    Route::get('/enrichment/jobs/{id}/stream', [EnrichmentJobController::class, 'stream']);
    Route::get('/settings', [SettingsController::class, 'show']);
    Route::get('/settings/health', [\App\Http\Controllers\Api\ApiStatusController::class, 'check']);
    Route::get('/monitoring/overview', [\App\Http\Controllers\Api\MonitoringController::class, 'overview']);
    Route::post('/settings/test-eden', [SettingsController::class, 'testEden']);
    Route::post('/settings/test-search', [SettingsController::class, 'testSearch']);
    Route::get('/settings/test-planner', [SettingsController::class, 'getPlannerPrompt']);
    Route::post('/settings/test-planner', [SettingsController::class, 'testPlanner']);
    Route::get('/agent/runs/{id}/stream', [AgentRunController::class, 'stream']);

    // Blacklist Domains Management
    Route::get('/blacklist', [\App\Http\Controllers\Api\BlacklistController::class, 'index']);
    Route::post('/blacklist', [\App\Http\Controllers\Api\BlacklistController::class, 'store']);
    Route::delete('/blacklist/{id}', [\App\Http\Controllers\Api\BlacklistController::class, 'destroy']);

    // Communication & Email Templates
    Route::get('/communication', [\App\Http\Controllers\Api\CommunicationController::class, 'index']);
    Route::post('/communication/branding', [\App\Http\Controllers\Api\CommunicationController::class, 'saveBranding']);
    Route::post('/communication/templates/{key}', [\App\Http\Controllers\Api\CommunicationController::class, 'saveTemplate']);
    Route::post('/communication/preview', [\App\Http\Controllers\Api\CommunicationController::class, 'preview']);
    Route::post('/communication/send-test', [\App\Http\Controllers\Api\CommunicationController::class, 'sendTest']);

    // Single Crawl / Search Step Test
    Route::post('/run/test-step', [\App\Http\Controllers\Api\CrawlStepTestController::class, 'testStep']);

    // Write access for Editor & Super-Admin
    Route::middleware(['role:Super-Admin|Editor'])->group(function () {
        Route::post('/cases', [CaseController::class, 'store']);
        Route::patch('/cases/{id}', [CaseController::class, 'update']);
        Route::post('/cases/{id}/stop', [CaseController::class, 'stopAll']);

        Route::post('/rows', [RowController::class, 'store']);
        Route::patch('/rows/{id}', [RowController::class, 'update']);
        Route::post('/cases/{id}/dedupe', [\App\Http\Controllers\Api\DeduplicationController::class, 'dedupe']);
        Route::post('/cases/{id}/classify-relevance', [\App\Http\Controllers\Api\RelevanceController::class, 'classify']);
        Route::post('/cases/{id}/resolve-relevance', [\App\Http\Controllers\Api\RelevanceController::class, 'resolve']);
        Route::post('/cases/{id}/extrapolate-email', [\App\Http\Controllers\Api\EmailExtrapolateController::class, 'extrapolate']);
        Route::post('/cases/{id}/resolve-domains', [\App\Http\Controllers\Api\DomainResolveController::class, 'resolve']);
        Route::post('/cases/{id}/sub-industries', [\App\Http\Controllers\Api\SubIndustryController::class, 'analyse']);
        Route::post('/cases/{id}/flag-catalog', [\App\Http\Controllers\Api\CatalogFlagController::class, 'flag']);
        Route::post('/cases/{id}/reflag-catalogs', [\App\Http\Controllers\Api\SingleCatalogScrapeController::class, 'reflag']);
        Route::post('/cases/{id}/scrape-catalog', [\App\Http\Controllers\Api\SingleCatalogScrapeController::class, 'scrape']);
        Route::post('/cases/{id}/deep-crawl-catalogs', [\App\Http\Controllers\Api\CatalogCrawlController::class, 'crawl']);
        Route::post('/contact-rows/cleanup', [\App\Http\Controllers\Api\ContactCleanupController::class, 'cleanup']);
        Route::post('/verify-email', [\App\Http\Controllers\Api\EmailVerifyController::class, 'verify']);
        Route::post('/verify-email-all', [\App\Http\Controllers\Api\EmailVerifyController::class, 'verifyAll']);
        Route::patch('/contact-rows', [\App\Http\Controllers\Api\ContactRowController::class, 'upsert']);

        Route::post('/run/cell', [\App\Http\Controllers\Api\CellRunController::class, 'run']);
        Route::post('/run/column', [\App\Http\Controllers\Api\ColumnRunController::class, 'run']);
        Route::post('/run/table', [\App\Http\Controllers\Api\TableRunController::class, 'run']);

        Route::post('/enrichment/dispatch', [EnrichmentJobController::class, 'dispatchJob'])
            ->middleware('throttle:20,1'); // Max 20 Dispatches pro Minute pro User
        Route::post('/enrichment/jobs/{id}/cancel', [EnrichmentJobController::class, 'cancel']);

        Route::post('/import/csv', [ImportController::class, 'importCsv']);
        Route::post('/import', [ImportController::class, 'importCsv']); // Alias to fix ImportWizard route discrepancy
        Route::post('/import/snapshot', [ImportController::class, 'importSnapshot']);
        Route::post('/import/xlsx', [ImportController::class, 'importXlsx']);
        // Raw Imports Pipeline
        Route::get('/raw-imports', [RawImportController::class, 'index']);
        Route::get('/raw-imports/{batchId}', [RawImportController::class, 'show']);
        Route::post('/raw-imports', [RawImportController::class, 'store']);
        Route::post('/import/raw', [RawImportController::class, 'store']); // Alias as specified in plan
        Route::post('/raw-imports/{batchId}/normalize', [RawImportController::class, 'normalize']);
        Route::get('/raw-imports/{batchId}/logs', [RawImportController::class, 'logs']);
        Route::post('/raw-imports/{batchId}/ai-column', [RawImportController::class, 'addAiColumn']);
        Route::post('/raw-imports/{batchId}/format-e164', [RawImportController::class, 'formatColumnE164']);
        Route::post('/raw-imports/{batchId}/promote', [RawImportController::class, 'promote']);
        Route::post('/raw-imports/{batchId}/rollback', [RawImportController::class, 'rollback']);
        Route::patch('/raw-imports/rows/{rowId}', [RawImportController::class, 'updateRow']);
        Route::delete('/raw-imports/{batchId}', [RawImportController::class, 'destroy']);
        // 3CX Phone Number E.164 Sync Service
        Route::post('/3cx/test-connection', [\App\Http\Controllers\Api\ThreeCXController::class, 'testConnection']);
        Route::post('/3cx/fetch-contacts', [\App\Http\Controllers\Api\ThreeCXController::class, 'fetchContacts']);
        Route::post('/3cx/update-single', [\App\Http\Controllers\Api\ThreeCXController::class, 'updateSingle']);
        Route::post('/3cx/batch-update', [\App\Http\Controllers\Api\ThreeCXController::class, 'batchUpdate']);
        // Prompt Management & Evaluations
        Route::get('/normalization-prompts', [NormalizationPromptController::class, 'index']);
        Route::post('/normalization-prompts', [NormalizationPromptController::class, 'store']);
        Route::patch('/normalization-prompts/{id}', [NormalizationPromptController::class, 'update']);
        Route::post('/normalization-prompts/{id}/activate', [NormalizationPromptController::class, 'activate']);
        Route::delete('/normalization-prompts/{id}', [NormalizationPromptController::class, 'destroy']);
        Route::post('/raw-imports/{batchId}/evaluate', [EvaluationController::class, 'run']);
        Route::get('/raw-imports/{batchId}/evaluations', [EvaluationController::class, 'index']);
        Route::get('/evaluations/{runId}', [EvaluationController::class, 'show']);

        Route::post('/agent/runs', [AgentRunController::class, 'store']);
        Route::post('/agent/runs/{id}/step', [AgentRunController::class, 'executeStep']);
        Route::post('/cases/{id}/agent', [AgentRunController::class, 'store']);
        Route::get('/cases/{id}/agent/{runId}', [AgentRunController::class, 'show']);
        Route::patch('/cases/{id}/agent/{runId}', [AgentRunController::class, 'resume']);
        Route::put('/cases/{id}/agent/{runId}', [AgentRunController::class, 'cancel']);
        Route::post('/cases/{id}/agent/{runId}/cancel', [AgentRunController::class, 'cancel']);
        Route::post('/cases/{id}/agent/{runId}/step', [AgentRunController::class, 'executeStep']);
        Route::post('/cases/{id}/agent/{runId}/extend', [\App\Http\Controllers\Api\AgentExtendController::class, 'extend']);
        Route::post('/import/preview', [\App\Http\Controllers\Api\ImportPreviewController::class, 'preview']);
        Route::post('/import/llm-map', [\App\Http\Controllers\Api\ImportPreviewController::class, 'llmMap']);

        // ── Self-Service User Account APIs (Jeder eingeloggte Benutzer) ──
        Route::get('/user/profile', [\App\Http\Controllers\Api\ProfileController::class, 'show']);
        Route::patch('/user/profile', [\App\Http\Controllers\Api\ProfileController::class, 'update']);
        Route::post('/user/change-password', [\App\Http\Controllers\Api\ProfileController::class, 'changePassword']);
        Route::post('/user/magic-link', [\App\Http\Controllers\Api\ProfileController::class, 'generateMagicLink']);
    });

    // Destructive / Settings access: Super-Admin only
    Route::middleware(['role:Super-Admin'])->group(function () {
        Route::delete('/cases/{id}', [CaseController::class, 'destroy']);
        Route::delete('/rows', [RowController::class, 'destroy']);
        Route::put('/settings', [SettingsController::class, 'update']);
        Route::delete('/settings', [SettingsController::class, 'destroyKey']);

        // ── Full User Management APIs ──
        Route::get('/admin/users', [\App\Http\Controllers\Api\UserManagementController::class, 'index']);
        Route::post('/admin/users', [\App\Http\Controllers\Api\UserManagementController::class, 'store']);
        Route::patch('/admin/users/{id}', [\App\Http\Controllers\Api\UserManagementController::class, 'update']);
        Route::delete('/admin/users/{id}', [\App\Http\Controllers\Api\UserManagementController::class, 'destroy']);
        Route::post('/admin/invitations', [\App\Http\Controllers\Api\UserManagementController::class, 'invite']);
        Route::delete('/admin/invitations/{id}', [\App\Http\Controllers\Api\UserManagementController::class, 'revokeInvitation']);
    });
});


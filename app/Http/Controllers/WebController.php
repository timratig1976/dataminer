<?php

namespace App\Http\Controllers;

use App\Models\DataCase;
use App\Models\GlobalSetting;
use Inertia\Inertia;
use Inertia\Response;
use Illuminate\Http\Request;

class WebController extends Controller
{
    /**
     * Dashboard view
     */
    public function dashboard(): Response
    {
        $cases = DataCase::withCount('rows')->orderByDesc('updated_at')->get();
        return Inertia::render('Dashboard', [
            'cases' => $cases,
        ]);
    }

    /**
     * Cases list view
     */
    public function cases(): Response
    {
        $cases = DataCase::withCount('rows')->orderByDesc('updated_at')->get();
        return Inertia::render('Cases/Index', [
            'cases' => $cases,
        ]);
    }

    /**
     * Case detail view (Table, AI runs, etc.)
     */
    public function caseDetail(string $id): Response
    {
        $case = DataCase::withCount('rows')->findOrFail($id);
        return Inertia::render('Cases/Show', [
            'case' => $case,
        ]);
    }

    /**
     * Central Queue & Runner Monitoring across all cases
     */
    public function monitoring(): Response
    {
        return Inertia::render('Monitoring');
    }

    /**
     * Settings view
     */
    public function settings(): Response
    {
        $settings = GlobalSetting::instance();
        return Inertia::render('Settings', [
            'settings' => [
                'eden_region' => $settings->eden_region,
                'has_eden_api_key' => !empty($settings->eden_api_key),
                'has_serp_api_key' => !empty($settings->serp_api_key),
                'has_serper_api_key' => !empty($settings->serper_api_key),
                'has_brave_api_key' => !empty($settings->brave_api_key),
                'has_firecrawl_api_key' => !empty($settings->firecrawl_api_key),
                'has_apify_api_token' => !empty($settings->apify_api_token),
                'edenApiKeyMasked' => $settings->eden_api_key ? substr($settings->eden_api_key, 0, 4) . '...' : null,
                'serperApiKeyMasked' => $settings->serper_api_key ? substr($settings->serper_api_key, 0, 4) . '...' : null,
                'serpApiKeyMasked' => $settings->serp_api_key ? substr($settings->serp_api_key, 0, 4) . '...' : null,
                'braveApiKeyMasked' => $settings->brave_api_key ? substr($settings->brave_api_key, 0, 4) . '...' : null,
                'firecrawlApiKeyMasked' => $settings->firecrawl_api_key ? substr($settings->firecrawl_api_key, 0, 4) . '...' : null,
                'apifyApiTokenMasked' => $settings->apify_api_token ? substr($settings->apify_api_token, 0, 4) . '...' : null,
                'planner_system_prompt' => $settings->planner_system_prompt,
            ]
        ]);
    }

    public function modelsSettings(): Response
    {
        $settings = GlobalSetting::instance();
        return Inertia::render('Settings/Models', [
            'allowlist' => $settings->model_allowlist ?? [],
        ]);
    }

    public function plannerSettings(\App\Services\PlannerService $planner): Response
    {
        $settings = GlobalSetting::instance();
        return Inertia::render('Settings/Planner', [
            'plannerPrompt' => $settings->planner_system_prompt,
            'defaultPrompt' => $planner->buildDefaultSystemPrompt(),
        ]);
    }

    public function llmTestSettings(): Response
    {
        return Inertia::render('Settings/LlmTest');
    }

    public function scraplingTest(): Response
    {
        return Inertia::render('ScraplingTest');
    }

    public function usersSettings(): Response
    {
        return Inertia::render('Settings/Users');
    }

    public function accountSettings(): Response
    {
        return Inertia::render('Settings/Account');
    }

    public function blacklistSettings(): Response
    {
        return Inertia::render('Settings/Blacklist');
    }

    public function communicationSettings(): Response
    {
        return Inertia::render('Settings/Communication');
    }

    public function rawImportsIndex(): Response
    {
        return Inertia::render('RawImports/Index');
    }

    public function threeCXSync(): Response
    {
        return Inertia::render('RawImports/ThreeCX');
    }

    public function rawImportsShow(string $batchId): Response
    {
        return Inertia::render('RawImports/Show', [
            'batchId' => $batchId,
        ]);
    }

    public function promptsSettings(): Response
    {
        return Inertia::render('Settings/Prompts');
    }
}

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
            ]
        ]);
    }
}

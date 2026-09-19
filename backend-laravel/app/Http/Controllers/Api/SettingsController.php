<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\GlobalSetting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SettingsController extends Controller
{
    /**
     * Get global application settings.
     * Sensitive API keys are masked for security unless explicit.
     * GET /api/settings
     */
    public function show(): JsonResponse
    {
        $settings = GlobalSetting::instance();

        return response()->json([
            'settings' => [
                'eden_region' => $settings->eden_region ?? 'us',
                'model_allowlist' => $settings->model_allowlist ?? [],
                'catalog_domains' => $settings->catalog_domains ?? [],
                'planner_system_prompt' => $settings->planner_system_prompt,
                // Mask keys: show only whether they are set or last 4 chars
                'has_eden_api_key' => !empty($settings->eden_api_key),
                'has_serp_api_key' => !empty($settings->serp_api_key),
                'has_serper_api_key' => !empty($settings->serper_api_key),
                'has_brave_api_key' => !empty($settings->brave_api_key),
                'has_apify_api_token' => !empty($settings->apify_api_token),
                'has_firecrawl_api_key' => !empty($settings->firecrawl_api_key),
            ]
        ]);
    }

    /**
     * Update global settings and API keys.
     * PUT /api/settings
     */
    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'eden_api_key' => 'nullable|string',
            'eden_region' => 'nullable|string|in:us,eu',
            'model_allowlist' => 'nullable|array',
            'catalog_domains' => 'nullable|array',
            'serper_api_key' => 'nullable|string',
            'serp_api_key' => 'nullable|string',
            'brave_api_key' => 'nullable|string',
            'apify_api_token' => 'nullable|string',
            'firecrawl_api_key' => 'nullable|string',
            'planner_system_prompt' => 'nullable|string',
        ]);

        $settings = GlobalSetting::instance();

        // Only update keys that were explicitly supplied and not empty placeholders
        foreach ($data as $key => $value) {
            if ($value !== null) {
                $settings->{$key} = $value;
            }
        }

        $settings->save();

        return response()->json([
            'message' => 'Settings updated successfully',
            'updated_at' => $settings->updated_at,
        ]);
    }
}

<?php

namespace App\Http\Middleware;

use App\Services\EmailTemplateService;
use Illuminate\Http\Request;
use Inertia\Middleware;

class HandleInertiaRequests extends Middleware
{
    /**
     * The root template that's loaded on the first page visit.
     *
     * @see https://inertiajs.com/server-side-setup#root-template
     *
     * @var string
     */
    protected $rootView = 'app';

    /**
     * Determines the current asset version.
     *
     * @see https://inertiajs.com/asset-versioning
     */
    public function version(Request $request): ?string
    {
        return parent::version($request);
    }

    /**
     * Define the props that are shared by default.
     *
     * @see https://inertiajs.com/shared-data
     *
     * @return array<string, mixed>
     */
    public function share(Request $request): array
    {
        $user = $request->user();

        // Cached or lightweight branding resolution
        $branding = null;
        try {
            $branding = app(EmailTemplateService::class)->getBranding();
        } catch (\Throwable $e) {}

        return [
            ...parent::share($request),
            'auth' => [
                'user' => $user ? [
                    'id' => $user->id,
                    'name' => $user->name,
                    'email' => $user->email,
                    'roles' => $user->roles->pluck('name'),
                ] : null,
            ],
            'branding' => $branding ? [
                'company_name' => $branding['company_name'] ?? 'DataMiner',
                'logo_url' => $branding['logo_url'] ?? '',
                'logo_icon_url' => $branding['logo_icon_url'] ?? '',
                'primary_color' => $branding['primary_color'] ?? '#ea580c',
            ] : null,
        ];
    }
}

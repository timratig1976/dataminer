<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="description" content="DataMiner 100k — High-Performance B2B Lead Engine & Data Enrichment Platform">
        <title inertia>{{ config('app.name', 'DataMiner') }} — High-Performance Lead Engine</title>

        <!-- Dynamic Favicon: Brand Logo Icon if configured, otherwise high-res SVG -->
        @php
            $brandingIcon = null;
            $iconMime = 'image/svg+xml';
            try {
                $b = app(\App\Services\EmailTemplateService::class)->getBranding();
                if (!empty($b['logo_icon_url'])) {
                    $brandingIcon = $b['logo_icon_url'];
                    $iconMime = str_ends_with(strtolower($brandingIcon), '.png') ? 'image/png' : (str_ends_with(strtolower($brandingIcon), '.svg') ? 'image/svg+xml' : 'image/x-icon');
                }
            } catch (\Throwable $e) {}
        @endphp
        @if($brandingIcon)
            <link rel="icon" type="{{ $iconMime }}" href="{{ $brandingIcon }}">
            <link rel="shortcut icon" href="{{ $brandingIcon }}">
            <link rel="apple-touch-icon" href="{{ $brandingIcon }}">
        @else
            <link rel="icon" type="image/svg+xml" href="{{ asset('favicon.svg') }}">
        @endif

        <!-- Fonts -->
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">

        <!-- Scripts -->
        @viteReactRefresh
        @vite(['resources/js/app.tsx', "resources/js/Pages/{$page['component']}.tsx"])
        @inertiaHead
    </head>
    <body class="antialiased min-h-screen" style="background: var(--bg); color: var(--text-1); font-family: var(--f);">
        @inertia
    </body>
</html>

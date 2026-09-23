<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Mail\TemplateMailable;
use App\Services\EmailTemplateService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Mail;

class CommunicationController extends Controller
{
    /**
     * Get branding, templates, and current mail configuration.
     * GET /api/communication
     */
    public function index(EmailTemplateService $service): JsonResponse
    {
        return response()->json([
            'branding' => $service->getBranding(),
            'templates' => $service->getTemplates(),
            'mail_config' => [
                'mailer' => config('mail.default'),
                'host' => config('mail.mailers.smtp.host'),
                'port' => config('mail.mailers.smtp.port'),
                'from_address' => config('mail.from.address'),
                'from_name' => config('mail.from.name'),
            ],
        ]);
    }

    /**
     * Save global branding settings and upload logo file if provided.
     * POST /api/communication/branding
     */
    public function saveBranding(Request $request, EmailTemplateService $service): JsonResponse
    {
        $validated = $request->validate([
            'company_name' => 'nullable|string|max:100',
            'from_name' => 'nullable|string|max:100',
            'logo_url' => 'nullable|string|max:500',
            'logo_icon_url' => 'nullable|string|max:500',
            'primary_color' => 'nullable|string|max:20',
            'background_color' => 'nullable|string|max:20',
            'card_color' => 'nullable|string|max:20',
            'text_color' => 'nullable|string|max:20',
            'link_color' => 'nullable|string|max:20',
            'font_family' => 'nullable|string|max:200',
            'button_radius' => 'nullable|string|max:20',
            'footer_text' => 'nullable|string|max:500',
            'logo_file' => 'nullable|file|mimes:png,jpg,jpeg,svg,webp|max:3072',
            'logo_icon_file' => 'nullable|file|mimes:png,jpg,jpeg,svg,webp|max:2048',
        ]);

        if ($request->hasFile('logo_file')) {
            $file = $request->file('logo_file');
            $filename = 'logo_' . time() . '.' . $file->getClientOriginalExtension();
            $file->move(public_path('uploads/branding'), $filename);
            $validated['logo_url'] = url("/uploads/branding/{$filename}");
        } elseif ($request->input('remove_logo') === '1' || $request->input('remove_logo') === true) {
            $validated['logo_url'] = '';
        }

        if ($request->hasFile('logo_icon_file')) {
            $file = $request->file('logo_icon_file');
            $filename = 'icon_' . time() . '.' . $file->getClientOriginalExtension();
            $file->move(public_path('uploads/branding'), $filename);
            $validated['logo_icon_url'] = url("/uploads/branding/{$filename}");
        } elseif ($request->input('remove_logo_icon') === '1' || $request->input('remove_logo_icon') === true) {
            $validated['logo_icon_url'] = '';
        }

        $branding = $service->saveBranding($validated);

        return response()->json([
            'ok' => true,
            'message' => 'E-Mail Branding erfolgreich gespeichert.',
            'branding' => $branding,
        ]);
    }

    /**
     * Save a specific template.
     * PUT/POST /api/communication/templates/{key}
     */
    public function saveTemplate(Request $request, string $key, EmailTemplateService $service): JsonResponse
    {
        $validated = $request->validate([
            'subject' => 'required|string|max:255',
            'html' => 'required|string',
            'text' => 'required|string',
            'footer' => 'nullable|string',
        ]);

        try {
            $template = $service->saveTemplate($key, $validated);
            return response()->json([
                'ok' => true,
                'message' => "Template '{$template['label']}' gespeichert.",
                'template' => $template,
            ]);
        } catch (\InvalidArgumentException $e) {
            return response()->json(['error' => $e->getMessage()], 400);
        }
    }

    /**
     * Preview a rendered template HTML.
     * POST /api/communication/preview
     */
    public function preview(Request $request, EmailTemplateService $service): JsonResponse
    {
        $templateKey = (string) $request->input('template_key', 'magic_link');
        $customBranding = $request->input('branding');
        $variables = $request->input('variables', []);

        // Demo sample data if none provided
        $defaults = [
            'magic_link_url' => url('/login/magic?token=demo-token-123456'),
            'invite_url' => url('/register/invitation/demo-invite-token'),
            'reset_url' => url('/reset-password/demo-token?email=user@example.com'),
            'role' => 'Editor',
            'email' => 'user@example.com',
        ];

        $rendered = $service->renderTemplate(
            $templateKey,
            array_merge($defaults, (array) $variables),
            is_array($customBranding) ? $customBranding : null
        );

        return response()->json([
            'subject' => $rendered['subject'],
            'html' => $rendered['html'],
            'text' => $rendered['text'],
        ]);
    }

    /**
     * Send a real test email to verify SMTP and template rendering.
     * POST /api/communication/send-test
     */
    public function sendTest(Request $request, EmailTemplateService $service): JsonResponse
    {
        $validated = $request->validate([
            'recipient' => 'required|email',
            'template_key' => 'nullable|string',
        ]);

        $recipient = $validated['recipient'];
        $templateKey = $validated['template_key'] ?: 'magic_link';

        try {
            Mail::to($recipient)->send(new TemplateMailable(
                templateKey: $templateKey,
                templateVariables: [
                    'magic_link_url' => url('/login/magic?token=test-token'),
                    'invite_url' => url('/register/invitation/test-invite-token'),
                    'reset_url' => url('/reset-password/test-token?email=' . urlencode($recipient)),
                    'role' => 'Super-Admin',
                    'email' => $recipient,
                ],
                overrideSubject: "[TEST] " . $service->getTemplates()[$templateKey]['subject']
            ));

            return response()->json([
                'ok' => true,
                'message' => "Test-E-Mail wurde erfolgreich an {$recipient} versendet!",
            ]);
        } catch (\Throwable $e) {
            return response()->json([
                'ok' => false,
                'error' => "Fehler beim E-Mail-Versand: " . $e->getMessage(),
            ], 500);
        }
    }
}

<?php

namespace App\Services;

use App\Models\GlobalSetting;

class EmailTemplateService
{
    public function getBranding(): array
    {
        $settings = GlobalSetting::instance();
        $stored = $settings->email_branding ?? [];
        if (!is_array($stored)) {
            $stored = [];
        }

        $merged = array_merge($this->defaultBranding(), $stored);

        // Normalize local URLs (e.g. http://127.0.0.1:8000/uploads/...) to current environment root
        foreach (['logo_url', 'logo_icon_url'] as $key) {
            if (!empty($merged[$key])) {
                $val = (string) $merged[$key];
                if (preg_match('#^https?://[^/]+(/uploads/branding/.*)$#', $val, $m)) {
                    $merged[$key] = url($m[1]);
                }
            }
        }

        return $merged;
    }

    public function saveBranding(array $branding): array
    {
        $settings = GlobalSetting::instance();
        $data = [
            'company_name' => trim((string) ($branding['company_name'] ?? 'DataMiner')),
            'from_name' => trim((string) ($branding['from_name'] ?? config('mail.from.name', 'DataMiner'))),
            'logo_url' => trim((string) ($branding['logo_url'] ?? '')),
            'logo_icon_url' => trim((string) ($branding['logo_icon_url'] ?? '')),
            'primary_color' => $this->normalizeColor((string) ($branding['primary_color'] ?? '#ea580c')), // DataMiner Orange
            'background_color' => $this->normalizeColor((string) ($branding['background_color'] ?? '#f8fafc')),
            'card_color' => $this->normalizeColor((string) ($branding['card_color'] ?? '#ffffff')),
            'text_color' => $this->normalizeColor((string) ($branding['text_color'] ?? '#1e293b')),
            'font_family' => trim((string) ($branding['font_family'] ?? "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif")),
            'button_radius' => trim((string) ($branding['button_radius'] ?? '8px')),
            'link_color' => $this->normalizeColor((string) ($branding['link_color'] ?? '#ea580c')),
            'footer_text' => trim((string) ($branding['footer_text'] ?? 'Automatische Nachricht aus DataMiner B2B Platform.')),
        ];

        $settings->update(['email_branding' => $data]);
        return $data;
    }

    public function getTemplates(): array
    {
        $settings = GlobalSetting::instance();
        $defaults = $this->defaultTemplates();
        $storedTemplates = $settings->email_templates ?? [];
        if (!is_array($storedTemplates)) {
            $storedTemplates = [];
        }

        $templates = [];
        foreach ($defaults as $key => $default) {
            $stored = $storedTemplates[$key] ?? [];
            $templates[$key] = [
                'label' => $default['label'],
                'subject' => (string) ($stored['subject'] ?? $default['subject']),
                'html' => (string) ($stored['html'] ?? $default['html']),
                'text' => (string) ($stored['text'] ?? $default['text']),
                'footer' => isset($stored['footer']) ? (string) $stored['footer'] : '',
                'available_placeholders' => $default['available_placeholders'],
            ];
        }

        return $templates;
    }

    public function saveTemplate(string $templateKey, array $payload): array
    {
        $settings = GlobalSetting::instance();
        $defaults = $this->defaultTemplates();
        if (!isset($defaults[$templateKey])) {
            throw new \InvalidArgumentException("Unbekannter Template Key: {$templateKey}");
        }

        $default = $defaults[$templateKey];
        $stored = $settings->email_templates ?? [];
        if (!is_array($stored)) {
            $stored = [];
        }

        $stored[$templateKey] = [
            'subject' => trim((string) ($payload['subject'] ?? $default['subject'])),
            'html' => (string) ($payload['html'] ?? $default['html']),
            'text' => (string) ($payload['text'] ?? $default['text']),
            'footer' => isset($payload['footer']) ? trim((string) $payload['footer']) : null,
        ];

        $settings->update(['email_templates' => $stored]);

        return [
            'label' => $default['label'],
            'subject' => $stored[$templateKey]['subject'],
            'html' => $stored[$templateKey]['html'],
            'text' => $stored[$templateKey]['text'],
            'footer' => $stored[$templateKey]['footer'] ?? null,
            'available_placeholders' => $default['available_placeholders'],
        ];
    }

    public function renderTemplate(string $templateKey, array $variables = [], ?array $customBranding = null): array
    {
        $branding = $customBranding ?: $this->getBranding();
        $templates = $this->getTemplates();
        $tpl = $templates[$templateKey] ?? $this->defaultTemplates()[$templateKey] ?? null;

        if (!$tpl) {
            throw new \InvalidArgumentException("Template {$templateKey} nicht gefunden.");
        }

        // Automatic First Name / Last Name resolution
        $fullName = trim((string) ($variables['name'] ?? $variables['user_name'] ?? ''));
        $firstName = $variables['first_name'] ?? '';
        $lastName = $variables['last_name'] ?? '';

        if (!$firstName && !$lastName && $fullName) {
            $parts = explode(' ', $fullName, 2);
            $firstName = $parts[0] ?? '';
            $lastName = $parts[1] ?? '';
        }

        $placeholders = array_merge([
            'name' => $fullName ?: 'Benutzer',
            'first_name' => $firstName ?: ($fullName ?: 'Benutzer'),
            'last_name' => $lastName ?: '',
            'company_name' => $branding['company_name'] ?? 'DataMiner',
            'app_url' => config('app.url'),
            'year' => date('Y'),
        ], $variables);

        $subject = $this->replacePlaceholders($tpl['subject'], $placeholders);
        $bodyHtml = $this->replacePlaceholders($tpl['html'], $placeholders);
        $bodyText = $this->replacePlaceholders($tpl['text'], $placeholders);

        // Per-template custom footer override if specified, otherwise global footer
        $templateFooter = !empty($tpl['footer']) ? $this->replacePlaceholders($tpl['footer'], $placeholders) : null;

        $fullHtml = $this->wrapInMasterLayout($bodyHtml, $subject, $branding, $templateFooter);

        return [
            'subject' => $subject,
            'html' => $fullHtml,
            'text' => $bodyText,
        ];
    }

    protected function replacePlaceholders(string $content, array $variables): string
    {
        foreach ($variables as $key => $value) {
            if (is_scalar($value)) {
                $content = str_replace([
                    '{{ ' . $key . ' }}',
                    '{{' . $key . '}}',
                    '{' . $key . '}',
                ], (string) $value, $content);
            }
        }
        return $content;
    }

    protected function wrapInMasterLayout(string $bodyHtml, string $title, array $branding, ?string $templateFooter = null): string
    {
        $logoHtml = !empty($branding['logo_url'])
            ? "<img src=\"{$branding['logo_url']}\" alt=\"{$branding['company_name']}\" style=\"max-height: 38px; width: auto; display: block; margin: 0 auto;\" />"
            : "<div style=\"font-size: 20px; font-weight: 700; color: {$branding['primary_color']}; text-align: center; letter-spacing: -0.02em;\">{$branding['company_name']}</div>";

        $finalFooter = $templateFooter !== null && trim($templateFooter) !== ''
            ? nl2br(e($templateFooter))
            : nl2br(e($branding['footer_text'] ?? 'Automatische Nachricht aus DataMiner B2B Platform.'));

        return <<<HTML
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{$title}</title>
</head>
<body style="margin: 0; padding: 20px 14px; background-color: {$branding['background_color']}; font-family: {$branding['font_family']}; color: {$branding['text_color']}; -webkit-font-smoothing: antialiased; overflow-y: hidden;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 520px; margin: 0 auto;">
        <tr>
            <td style="padding-bottom: 16px; text-align: center;">
                {$logoHtml}
            </td>
        </tr>
        <tr>
            <td>
                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: {$branding['card_color']}; border-radius: {$branding['button_radius']}; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
                    <tr>
                        <td style="padding: 24px 22px; font-size: 13.5px; line-height: 1.55; color: {$branding['text_color']};">
                            {$bodyHtml}
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
        <tr>
            <td style="padding-top: 16px; text-align: center; font-size: 11px; line-height: 1.4; color: #94a3b8;">
                {$finalFooter}<br>
                &copy; {$branding['company_name']} · Alle Rechte vorbehalten.
            </td>
        </tr>
    </table>
</body>
</html>
HTML;
    }

    public function defaultBranding(): array
    {
        return [
            'company_name' => 'DataMiner',
            'from_name' => 'DataMiner',
            'logo_url' => '',
            'logo_icon_url' => '',
            'primary_color' => '#ea580c',
            'background_color' => '#f8fafc',
            'card_color' => '#ffffff',
            'text_color' => '#1e293b',
            'font_family' => "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            'button_radius' => '8px',
            'link_color' => '#ea580c',
            'footer_text' => 'Automatische Nachricht aus DataMiner B2B Platform.',
        ];
    }

    public function defaultTemplates(): array
    {
        return [
            'magic_link' => [
                'label' => 'Magic Login Link',
                'subject' => 'Dein Zugangs-Link zu DataMiner',
                'html' => '<h2 style="margin-top: 0; font-size: 18px; font-weight: 700; color: #0f172a;">Anmeldung bei DataMiner</h2><p>Hallo {{ first_name }},</p><p>klicke auf den folgenden Button, um dich sicher ohne Passwort anzumelden:</p><p style="margin: 28px 0; text-align: center;"><a href="{{ magic_link_url }}" style="background-color: #ea580c; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px; display: inline-block;">Jetzt direkt anmelden</a></p><p style="font-size: 12px; color: #64748b;">Dieser Link ist 15 Minuten lang gültig und kann nur einmal verwendet werden.<br>Falls du diese Anfrage nicht gestellt hast, kannst du diese E-Mail ignorieren.</p>',
                'text' => "Anmeldung bei DataMiner\n\nHallo {{ first_name }},\n\nKlicke auf den folgenden Link um dich anzumelden:\n{{ magic_link_url }}\n\nDieser Link ist 15 Minuten lang gültig.",
                'available_placeholders' => ['first_name', 'last_name', 'name', 'email', 'magic_link_url', 'company_name'],
            ],
            'invitation' => [
                'label' => 'Team-Einladung',
                'subject' => 'Du wurdest zu DataMiner eingeladen',
                'html' => '<h2 style="margin-top: 0; font-size: 18px; font-weight: 700; color: #0f172a;">Willkommen im Team!</h2><p>Hallo {{ first_name }},</p><p>du wurdest eingeladen, DataMiner als <strong>{{ role }}</strong> beizutreten.</p><p style="margin: 28px 0; text-align: center;"><a href="{{ invite_url }}" style="background-color: #ea580c; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px; display: inline-block;">Einladung annehmen & Passwort setzen</a></p><p style="font-size: 12px; color: #64748b;">Dieser Einladungslink ist 48 Stunden lang gültig.</p>',
                'text' => "Willkommen im Team!\n\nHallo {{ first_name }},\n\nDu wurdest eingeladen, DataMiner als {{ role }} beizutreten.\n\nKlicke auf diesen Link um dein Passwort zu setzen:\n{{ invite_url }}",
                'available_placeholders' => ['first_name', 'last_name', 'name', 'email', 'role', 'invite_url', 'company_name'],
            ],
            'password_reset' => [
                'label' => 'Passwort zurücksetzen',
                'subject' => 'Passwort zurücksetzen für dein DataMiner-Konto',
                'html' => '<h2 style="margin-top: 0; font-size: 18px; font-weight: 700; color: #0f172a;">Passwort zurücksetzen</h2><p>Hallo {{ first_name }},</p><p>wir haben eine Anfrage erhalten, das Passwort für dein DataMiner-Konto zurückzusetzen.</p><p style="margin: 28px 0; text-align: center;"><a href="{{ reset_url }}" style="background-color: #ea580c; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px; display: inline-block;">Neues Passwort vergeben</a></p><p style="font-size: 12px; color: #64748b;">Dieser Link läuft in 60 Minuten ab. Falls du kein neues Passwort angefordert hast, ist keine Aktion erforderlich.</p>',
                'text' => "Passwort zurücksetzen\n\nHallo {{ first_name }},\n\nKlicke auf den folgenden Link um ein neues Passwort zu vergeben:\n{{ reset_url }}\n\nDieser Link ist 60 Minuten gültig.",
                'available_placeholders' => ['first_name', 'last_name', 'name', 'email', 'reset_url', 'company_name'],
            ],
            'welcome' => [
                'label' => 'Willkommen & Konto aktiviert',
                'subject' => 'Dein DataMiner-Konto ist jetzt aktiv',
                'html' => '<h2 style="margin-top: 0; font-size: 18px; font-weight: 700; color: #0f172a;">Willkommen bei DataMiner!</h2><p>Hallo {{ first_name }} {{ last_name }},</p><p>dein Benutzerkonto wurde erfolgreich aktiviert. Du kannst dich ab sofort mit deiner E-Mail-Adresse anmelden und auf alle freigegebenen Cases und Daten zugreifen.</p><p style="margin: 28px 0; text-align: center;"><a href="{{ app_url }}/login" style="background-color: #ea580c; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px; display: inline-block;">Zum DataMiner Login</a></p><p style="font-size: 12px; color: #64748b;">Bei Fragen steht dir dein Administrator jederzeit zur Verfügung.</p>',
                'text' => "Willkommen bei DataMiner!\n\nHallo {{ first_name }} {{ last_name }},\n\nDein Benutzerkonto wurde erfolgreich aktiviert.\nMelde dich hier an: {{ app_url }}/login",
                'available_placeholders' => ['first_name', 'last_name', 'name', 'email', 'app_url', 'company_name'],
            ],
        ];
    }

    protected function normalizeColor(string $color): string
    {
        $color = trim($color);
        if (preg_match('/^#[a-f0-9]{3,8}$/i', $color)) {
            return $color;
        }
        return '#ea580c';
    }
}

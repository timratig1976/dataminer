<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Models\MagicLogin;
use App\Models\UserAudit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;

class MagicLoginController extends Controller
{
    /**
     * Request a Magic Link via Email.
     * POST /api/auth/magic-link
     */
    public function send(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'email' => 'required|email',
        ]);

        $user = User::where('email', $validated['email'])->first();
        if (!$user) {
            // Aus Sicherheitsgründen keine E-Mail-Präsenz leaken
            return response()->json([
                'message' => 'Falls ein Konto existiert, wurde der Magic Link gesendet.',
            ]);
        }

        $token = Str::random(48);
        $magic = MagicLogin::create([
            'id' => (string) Str::uuid(),
            'user_id' => $user->id,
            'token' => $token,
            'expires_at' => now()->addMinutes(15),
        ]);

        $magicUrl = url("/magic-login/{$token}");

        // Real branded email dispatch via TemplateMailable
        try {
            \Illuminate\Support\Facades\Mail::to($user->email)->send(
                new \App\Mail\TemplateMailable(
                    templateKey: 'magic_link',
                    templateVariables: [
                        'magic_link_url' => $magicUrl,
                        'email' => $user->email,
                    ]
                )
            );
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("[MagicLogin] Mail dispatch failed: " . $e->getMessage());
        }

        UserAudit::create([
            'id' => (string) Str::uuid(),
            'user_id' => $user->id,
            'action' => 'magic_link_requested',
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
        ]);

        return response()->json([
            'message' => 'Magic Link generiert',
            'magic_url' => $magicUrl,
        ]);
    }

    /**
     * Consume Magic Link and log user in.
     * GET /magic-login/{token}
     */
    public function consume(Request $request, string $token): RedirectResponse
    {
        $magic = MagicLogin::where('token', $token)->first();

        if (!$magic || !$magic->isValid()) {
            return redirect('/login')->withErrors(['email' => 'Dieser Magic Link ist ungültig oder abgelaufen.']);
        }

        $magic->update(['used_at' => now()]);
        Auth::login($magic->user, true);
        $request->session()->regenerate();

        UserAudit::create([
            'id' => (string) Str::uuid(),
            'user_id' => $magic->user_id,
            'action' => 'magic_login_success',
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
        ]);

        return redirect()->intended('/');
    }
}

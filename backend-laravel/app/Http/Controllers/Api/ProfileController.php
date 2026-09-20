<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\UserAudit;
use App\Models\MagicLogin;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class ProfileController extends Controller
{
    /**
     * Get current user profile and session info.
     * GET /api/user/profile
     */
    public function show(Request $request): JsonResponse
    {
        $user = $request->user();
        return response()->json([
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'roles' => $user->roles->pluck('name'),
                'created_at' => $user->created_at->toIso8601String(),
            ],
        ]);
    }

    /**
     * Update current user profile (name, email).
     * PATCH /api/user/profile
     */
    public function update(Request $request): JsonResponse
    {
        $user = $request->user();

        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'email' => 'required|email|unique:users,email,' . $user->id,
        ]);

        $user->update($validated);

        UserAudit::create([
            'id' => (string) Str::uuid(),
            'user_id' => $user->id,
            'action' => 'profile_updated',
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
            'details' => ['name' => $user->name, 'email' => $user->email],
        ]);

        return response()->json([
            'message' => 'Profil erfolgreich aktualisiert',
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'roles' => $user->roles->pluck('name'),
            ],
        ]);
    }

    /**
     * Self-service change password.
     * POST /api/user/change-password
     */
    public function changePassword(Request $request): JsonResponse
    {
        $user = $request->user();

        $validated = $request->validate([
            'current_password' => 'required|string',
            'password' => 'required|string|min:8|confirmed',
        ]);

        if (!Hash::check($validated['current_password'], $user->password)) {
            return response()->json([
                'error' => 'Das aktuelle Passwort ist nicht korrekt.',
            ], 422);
        }

        $user->update([
            'password' => Hash::make($validated['password']),
        ]);

        UserAudit::create([
            'id' => (string) Str::uuid(),
            'user_id' => $user->id,
            'action' => 'password_changed_self_service',
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
        ]);

        return response()->json([
            'message' => 'Passwort erfolgreich geändert',
        ]);
    }

    /**
     * Self-service generate personal magic login link.
     * POST /api/user/magic-link
     */
    public function generateMagicLink(Request $request): JsonResponse
    {
        $user = $request->user();

        $token = Str::random(48);
        $magic = MagicLogin::create([
            'id' => (string) Str::uuid(),
            'user_id' => $user->id,
            'token' => $token,
            'expires_at' => now()->addMinutes(30),
        ]);

        $magicUrl = url("/magic-login/{$token}");

        UserAudit::create([
            'id' => (string) Str::uuid(),
            'user_id' => $user->id,
            'action' => 'self_service_magic_link_created',
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
        ]);

        return response()->json([
            'message' => 'Persönlicher Magic Link generiert',
            'magic_url' => $magicUrl,
            'expires_in_minutes' => 30,
        ]);
    }
}

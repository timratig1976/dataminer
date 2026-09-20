<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Models\UserInvitation;
use App\Models\UserAudit;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Inertia\Response;

class InvitationAcceptController extends Controller
{
    /**
     * Show invitation accept page.
     * GET /invitations/{token}
     */
    public function show(string $token): Response|RedirectResponse
    {
        $invitation = UserInvitation::where('token', $token)->first();

        if (!$invitation || $invitation->isExpired() || $invitation->isAccepted()) {
            return redirect('/login')->withErrors(['email' => 'Diese Einladung ist ungültig oder abgelaufen.']);
        }

        return Inertia::render('Auth/AcceptInvitation', [
            'token' => $token,
            'email' => $invitation->email,
            'role' => $invitation->role,
        ]);
    }

    /**
     * Accept invitation and set password.
     * POST /invitations/{token}
     */
    public function accept(Request $request, string $token): RedirectResponse
    {
        $invitation = UserInvitation::where('token', $token)->first();

        if (!$invitation || $invitation->isExpired() || $invitation->isAccepted()) {
            return redirect('/login')->withErrors(['email' => 'Diese Einladung ist ungültig oder abgelaufen.']);
        }

        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'password' => 'required|string|min:8|confirmed',
        ]);

        $user = User::create([
            'name' => $validated['name'],
            'email' => $invitation->email,
            'password' => Hash::make($validated['password']),
            'email_verified_at' => now(),
        ]);

        $user->assignRole($invitation->role);
        $invitation->update(['accepted_at' => now()]);

        Auth::login($user, true);
        $request->session()->regenerate();

        UserAudit::create([
            'id' => (string) Str::uuid(),
            'user_id' => $user->id,
            'action' => 'invitation_accepted',
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
            'details' => ['role' => $invitation->role],
        ]);

        return redirect()->intended('/');
    }
}

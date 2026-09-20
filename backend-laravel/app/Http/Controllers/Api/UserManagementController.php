<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Models\UserInvitation;
use App\Models\UserAudit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Spatie\Permission\Models\Role;

class UserManagementController extends Controller
{
    /**
     * List all users with their roles.
     * GET /api/admin/users
     */
    public function index(Request $request): JsonResponse
    {
        $users = User::with('roles')->orderBy('name', 'asc')->get()->map(function ($u) {
            return [
                'id' => $u->id,
                'name' => $u->name,
                'email' => $u->email,
                'email_verified_at' => $u->email_verified_at,
                'roles' => $u->roles->pluck('name'),
                'created_at' => $u->created_at->toIso8601String(),
            ];
        });

        $roles = Role::pluck('name');
        $invitations = UserInvitation::whereNull('accepted_at')
            ->where('expires_at', '>', now())
            ->orderByDesc('created_at')
            ->get();

        $audits = UserAudit::with('user:id,name,email')
            ->orderByDesc('created_at')
            ->limit(50)
            ->get();

        return response()->json([
            'users' => $users,
            'roles' => $roles,
            'invitations' => $invitations,
            'audits' => $audits,
        ]);
    }

    /**
     * Create a user directly or update role.
     * POST /api/admin/users
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'email' => 'required|email|unique:users,email',
            'role' => 'required|string|in:Super-Admin,Editor,Viewer',
            'password' => 'nullable|string|min:8',
        ]);

        $password = $validated['password'] ?: Str::random(16);

        $user = User::create([
            'name' => $validated['name'],
            'email' => $validated['email'],
            'password' => Hash::make($password),
            'email_verified_at' => now(),
        ]);

        $user->assignRole($validated['role']);

        UserAudit::create([
            'id' => (string) Str::uuid(),
            'user_id' => $request->user()?->id,
            'action' => 'user_created',
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
            'details' => [
                'created_user_id' => $user->id,
                'email' => $user->email,
                'role' => $validated['role'],
            ],
        ]);

        return response()->json([
            'message' => 'Benutzer erfolgreich angelegt',
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'roles' => [$validated['role']],
            ],
            'temporary_password' => empty($validated['password']) ? $password : null,
        ], 201);
    }

    /**
     * Update user role or details.
     * PATCH /api/admin/users/{id}
     */
    public function update(Request $request, int $id): JsonResponse
    {
        $user = User::findOrFail($id);

        $validated = $request->validate([
            'name' => 'sometimes|string|max:255',
            'email' => 'sometimes|email|unique:users,email,' . $id,
            'role' => 'sometimes|string|in:Super-Admin,Editor,Viewer',
            'password' => 'nullable|string|min:8',
        ]);

        if (isset($validated['name'])) $user->name = $validated['name'];
        if (isset($validated['email'])) $user->email = $validated['email'];
        if (!empty($validated['password'])) $user->password = Hash::make($validated['password']);
        $user->save();

        if (isset($validated['role'])) {
            $user->syncRoles([$validated['role']]);
        }

        UserAudit::create([
            'id' => (string) Str::uuid(),
            'user_id' => $request->user()?->id,
            'action' => 'user_updated',
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
            'details' => [
                'target_user_id' => $user->id,
                'updated_fields' => array_keys($validated),
            ],
        ]);

        return response()->json([
            'message' => 'Benutzer aktualisiert',
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'roles' => $user->roles->pluck('name'),
            ],
        ]);
    }

    /**
     * Delete user.
     * DELETE /api/admin/users/{id}
     */
    public function destroy(Request $request, int $id): JsonResponse
    {
        if ($request->user()?->id === $id) {
            return response()->json(['error' => 'Eigenen Account kann man nicht löschen'], 400);
        }

        $user = User::findOrFail($id);
        $deletedEmail = $user->email;
        $user->delete();

        UserAudit::create([
            'id' => (string) Str::uuid(),
            'user_id' => $request->user()?->id,
            'action' => 'user_deleted',
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
            'details' => ['deleted_email' => $deletedEmail],
        ]);

        return response()->json(['message' => 'Benutzer gelöscht']);
    }

    /**
     * Send User Invitation.
     * POST /api/admin/invitations
     */
    public function invite(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'email' => 'required|email',
            'role' => 'required|string|in:Super-Admin,Editor,Viewer',
        ]);

        if (User::where('email', $validated['email'])->exists()) {
            return response()->json(['error' => 'Benutzer mit dieser E-Mail existiert bereits'], 400);
        }

        $token = Str::random(48);
        $invitation = UserInvitation::create([
            'id' => (string) Str::uuid(),
            'email' => $validated['email'],
            'role' => $validated['role'],
            'token' => $token,
            'invited_by' => $request->user()?->id,
            'expires_at' => now()->addDays(7),
        ]);

        $inviteUrl = url("/invitations/{$token}");

        UserAudit::create([
            'id' => (string) Str::uuid(),
            'user_id' => $request->user()?->id,
            'action' => 'invitation_sent',
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
            'details' => ['email' => $invitation->email, 'role' => $invitation->role],
        ]);

        return response()->json([
            'message' => 'Einladung erfolgreich erstellt',
            'invite_url' => $inviteUrl,
            'invitation' => $invitation,
        ]);
    }

    /**
     * Revoke invitation.
     * DELETE /api/admin/invitations/{id}
     */
    public function revokeInvitation(Request $request, string $id): JsonResponse
    {
        $inv = UserInvitation::findOrFail($id);
        $inv->delete();
        return response()->json(['message' => 'Einladung widerrufen']);
    }
}

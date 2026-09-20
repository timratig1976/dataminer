<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Models\User;
use App\Models\UserInvitation;
use App\Models\MagicLogin;
use Spatie\Permission\Models\Role;

class UserManagementTest extends TestCase
{
    protected User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(\Database\Seeders\RoleAndPermissionSeeder::class);

        $this->admin = User::firstOrCreate(
            ['email' => 'admin@dataminer.local'],
            ['name' => 'Super Admin', 'password' => bcrypt('password')]
        );
        $this->admin->assignRole('Super-Admin');
    }

    public function test_admin_can_list_users_and_roles(): void
    {
        $response = $this->actingAs($this->admin)->getJson('/api/admin/users');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'users',
            'roles',
            'invitations',
            'audits',
        ]);
    }

    public function test_admin_can_invite_user(): void
    {
        $response = $this->actingAs($this->admin)->postJson('/api/admin/invitations', [
            'email' => 'invited_unit@example.com',
            'role' => 'Editor',
        ]);

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'message',
            'invite_url',
            'invitation',
        ]);

        $this->assertDatabaseHas('user_invitations', [
            'email' => 'invited_unit@example.com',
            'role' => 'Editor',
        ]);
    }

    public function test_can_request_and_consume_magic_link(): void
    {
        $user = User::factory()->create([
            'email' => 'magic_unit@example.com',
        ]);

        $res = $this->postJson('/api/auth/magic-link', [
            'email' => 'magic_unit@example.com',
        ]);

        $res->assertStatus(200);
        $magicUrl = $res->json('magic_url');
        $this->assertNotNull($magicUrl);

        $token = basename(parse_url($magicUrl, PHP_URL_PATH));
        $consumeRes = $this->get("/magic-login/{$token}");
        $consumeRes->assertRedirect('/');

        $this->assertAuthenticatedAs($user);
    }
}

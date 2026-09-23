<?php

namespace Tests\Feature\Auth;

use App\Mail\TemplateMailable;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Password;
use Tests\TestCase;

class PasswordResetTest extends TestCase
{
    use RefreshDatabase;

    public function test_reset_password_link_can_be_requested(): void
    {
        Mail::fake();

        $user = User::factory()->create();

        $this->post('/forgot-password', ['email' => $user->email]);

        Mail::assertSent(TemplateMailable::class, function ($mail) use ($user) {
            return $mail->templateKey === 'password_reset'
                && $mail->hasTo($user->email);
        });
    }

    public function test_password_can_be_reset_with_valid_token(): void
    {
        Mail::fake();

        $user = User::factory()->create();
        $token = Password::createToken($user);

        $response = $this->post('/reset-password', [
            'token' => $token,
            'email' => $user->email,
            'password' => 'new-password-123',
            'password_confirmation' => 'new-password-123',
        ]);

        $response
            ->assertSessionHasNoErrors()
            ->assertStatus(200);

        $this->assertTrue(auth()->attempt([
            'email' => $user->email,
            'password' => 'new-password-123',
        ]));
    }
}

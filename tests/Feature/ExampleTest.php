<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Models\User;

class ExampleTest extends TestCase
{
    /**
     * A basic test example.
     */
    public function test_the_application_returns_a_successful_response(): void
    {
        $user = User::firstOrCreate(
            ['email' => 'admin@dataminer.local'],
            ['name' => 'Super Admin', 'password' => bcrypt('password')]
        );

        $response = $this->actingAs($user)->get('/');

        $response->assertStatus(200);
    }
}

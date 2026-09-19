<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Models\User;
use App\Models\DataCase;
use App\Models\Row;
use Illuminate\Foundation\Testing\RefreshDatabase;

class DataMinerApiTest extends TestCase
{
    public function test_can_list_cases(): void
    {
        $response = $this->getJson('/api/cases');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            '*' => [
                'id',
                'name',
                'rows_count',
            ]
        ]);
    }

    public function test_can_fetch_case_rows(): void
    {
        $case = DataCase::first();
        if (!$case) {
            $this->markTestSkipped('No case available in database');
        }

        $response = $this->getJson("/api/rows?caseId={$case->id}");

        $response->assertStatus(200);
        $this->assertIsArray($response->json());
        $this->assertNotEmpty($response->json());
    }

    public function test_super_admin_has_permissions(): void
    {
        $admin = User::where('email', 'admin@dataminer.local')->first();
        $this->assertNotNull($admin);
        $this->assertTrue($admin->hasRole('Super-Admin'));
        $this->assertTrue($admin->can('create cases'));
        $this->assertTrue($admin->can('run ai'));
    }
}

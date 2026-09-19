<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Models\User;
use App\Models\DataCase;
use App\Models\Row;
use Laravel\Sanctum\Sanctum;

class DataMinerApiTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        
        $this->seed(\Database\Seeders\RoleAndPermissionSeeder::class);

        $admin = User::firstOrCreate(
            ['email' => 'admin@dataminer.local'],
            ['name' => 'Super Admin', 'password' => bcrypt('password')]
        );
        $admin->assignRole('Super-Admin');

        Sanctum::actingAs($admin, ['*']);
    }

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
        $case = DataCase::firstOrCreate(
            ['name' => 'Automated Test Case'],
            [
                'id' => (string) \Illuminate\Support\Str::uuid(),
                'ai_columns' => [],
                'col_order' => [],
                'eden_region' => 'us',
            ]
        );

        $row = Row::firstOrCreate(
            ['case_id' => $case->id, 'row_index' => 0],
            [
                'id' => (string) \Illuminate\Support\Str::uuid(),
                'data' => ['company_name' => 'Acme Test GmbH'],
                'cell_statuses' => [],
                'cell_errors' => [],
            ]
        );

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

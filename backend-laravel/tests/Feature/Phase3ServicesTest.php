<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Models\User;
use App\Models\DataCase;
use App\Models\GlobalSetting;
use Laravel\Sanctum\Sanctum;
use Illuminate\Support\Str;

class Phase3ServicesTest extends TestCase
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

    public function test_can_read_and_update_settings(): void
    {
        // 1. Read settings
        $response = $this->getJson('/api/settings');
        $response->assertStatus(200);
        $response->assertJsonStructure([
            'settings' => [
                'eden_region',
                'model_allowlist',
                'catalog_domains',
            ]
        ]);

        // 2. Update settings
        $updateRes = $this->putJson('/api/settings', [
            'eden_region' => 'eu',
            'serp_api_key' => 'test_key_123',
        ]);
        $updateRes->assertStatus(200);

        $setting = GlobalSetting::instance();
        $this->assertEquals('eu', $setting->eden_region);
        $this->assertEquals('test_key_123', $setting->serp_api_key);
    }

    public function test_can_import_csv(): void
    {
        $case = DataCase::firstOrCreate(
            ['name' => 'CSV Import Test Case'],
            [
                'id' => (string) Str::uuid(),
                'ai_columns' => [],
                'col_order' => [],
                'eden_region' => 'us',
            ]
        );

        $csv = "Unternehmen,Website,Stadt\nAcme Corp,https://acme.test,Berlin\nBeta Ltd,https://beta.test,Hamburg";

        $response = $this->postJson('/api/import/csv', [
            'case_id' => $case->id,
            'csv' => $csv,
        ]);

        $response->assertStatus(200);
        $response->assertJson([
            'message' => 'CSV imported successfully',
            'result' => [
                'imported' => 2,
            ]
        ]);
    }

    public function test_can_start_agent_run(): void
    {
        $case = DataCase::firstOrCreate(
            ['name' => 'Agent Run Test Case'],
            [
                'id' => (string) Str::uuid(),
                'ai_columns' => [],
                'col_order' => [],
                'eden_region' => 'us',
            ]
        );

        $response = $this->postJson('/api/agent/runs', [
            'case_id' => $case->id,
            'goal' => 'Finde 10 Heizungsbauer in Rostock',
        ]);

        $response->assertStatus(201);
        $response->assertJsonStructure([
            'message',
            'run' => [
                'id',
                'case_id',
                'goal',
                'status',
                'state',
            ]
        ]);
    }
}

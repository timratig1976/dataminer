<?php

namespace Tests\Feature;

use App\Models\BatchEvaluationRun;
use App\Models\ImportBatch;
use App\Models\NormalizationPrompt;
use App\Models\RawImport;
use App\Models\User;
use App\Services\EvaluationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class EvaluationTest extends TestCase
{
    use RefreshDatabase;

    protected User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(\Database\Seeders\RoleAndPermissionSeeder::class);
        $this->seed(\Database\Seeders\NormalizationPromptSeeder::class);

        $this->admin = User::firstOrCreate(
            ['email' => 'admin@dataminer.local'],
            ['name' => 'Super Admin', 'password' => bcrypt('password')]
        );
        $this->admin->assignRole('Super-Admin');

        $this->actingAs($this->admin);
        Sanctum::actingAs($this->admin, ['*']);
    }

    public function test_evaluation_flags_invented_domain_not_present_in_raw(): void
    {
        $service = app(EvaluationService::class);

        $raw = [
            'Firma' => 'Hotel Sonnenalp GmbH',
            'Ort' => 'Sonthofen',
            // Notice: NO domain field!
        ];

        $normalized = [
            'company_fields' => [
                'company_name' => 'Hotel Sonnenalp GmbH',
                'domain' => 'sonnenalp.de', // Hallucinated/invented!
            ],
            'contact_fields' => [],
        ];

        $flags = $service->detectHallucinatedFields($normalized, $raw);

        $this->assertCount(1, $flags);
        $this->assertEquals('domain', $flags[0]['field']);
        $this->assertEquals('sonnenalp.de', $flags[0]['invented_value']);
    }

    public function test_evaluation_does_not_flag_exact_or_substring_matches(): void
    {
        $service = app(EvaluationService::class);

        $raw = [
            'Firma' => 'Alpha Software AG',
            'Webseite' => 'https://alpha-software.de',
            'Telefon' => '089-123 456 78',
            'Ansprechpartner' => 'Dr. Thomas Weber',
        ];

        $normalized = [
            'company_fields' => [
                'company_name' => 'Alpha Software AG',
                'domain' => 'alpha-software.de',
                'phone' => '089-123 456 78',
            ],
            'contact_fields' => [
                'first_name' => 'Thomas',
                'last_name' => 'Weber',
            ],
        ];

        $flags = $service->detectHallucinatedFields($normalized, $raw);

        $this->assertEmpty($flags, 'No flags should be raised for present data');
    }

    public function test_evaluation_run_creates_database_record_with_stats(): void
    {
        $batch = ImportBatch::create([
            'id' => (string) Str::uuid(),
            'label' => 'Evaluation Test Batch',
            'status' => 'pending',
            'total_rows' => 5,
        ]);

        for ($i = 0; $i < 5; $i++) {
            RawImport::create([
                'id' => (string) Str::uuid(),
                'import_batch_id' => $batch->id,
                'source_row_index' => $i,
                'raw_data' => [
                    'Firma' => "Firma $i GmbH",
                    'Web' => "firma$i.de",
                ],
                'status' => 'pending',
            ]);
        }

        $res = $this->postJson("/api/raw-imports/{$batch->id}/evaluate", [
            'sample_percent' => 100,
        ]);

        $res->assertStatus(200)
            ->assertJsonStructure(['message', 'run' => ['id', 'rows_processed', 'status']]);

        $run = BatchEvaluationRun::where('import_batch_id', $batch->id)->first();
        $this->assertNotNull($run);
        $this->assertEquals('completed', $run->status);
        $this->assertEquals(5, $run->rows_processed);
        $this->assertEquals(5, $run->rows_normalized);
        $this->assertNotNull($run->avg_confidence);
    }

    public function test_activate_prompt_deactivates_other_prompts_of_same_schema(): void
    {
        $p1 = NormalizationPrompt::create([
            'id' => (string) Str::uuid(),
            'name' => 'prompt_a',
            'schema_type' => 'mixed',
            'system_prompt' => 'A',
            'user_prompt_template' => 'A',
            'is_active' => true,
        ]);

        $p2 = NormalizationPrompt::create([
            'id' => (string) Str::uuid(),
            'name' => 'prompt_b',
            'schema_type' => 'mixed',
            'system_prompt' => 'B',
            'user_prompt_template' => 'B',
            'is_active' => false,
        ]);

        $this->postJson("/api/normalization-prompts/{$p2->id}/activate")
            ->assertStatus(200);

        $p1->refresh();
        $p2->refresh();

        $this->assertFalse($p1->is_active);
        $this->assertTrue($p2->is_active);
    }

    public function test_normalizer_uses_active_database_prompt(): void
    {
        $customPrompt = NormalizationPrompt::create([
            'id' => (string) Str::uuid(),
            'name' => 'custom_active_test',
            'schema_type' => '*',
            'system_prompt' => 'CUSTOM SYSTEM PROMPT IDENTIFIER 12345',
            'user_prompt_template' => 'CUSTOM USER TEMPLATE {{rows}}',
            'model' => 'openai/gpt-4o',
            'is_active' => true,
        ]);

        // Activate it
        $this->postJson("/api/normalization-prompts/{$customPrompt->id}/activate");

        $batch = ImportBatch::create([
            'id' => (string) Str::uuid(),
            'label' => 'Prompt Check Batch',
            'status' => 'pending',
            'total_rows' => 1,
        ]);

        $row = RawImport::create([
            'id' => (string) Str::uuid(),
            'import_batch_id' => $batch->id,
            'source_row_index' => 0,
            'raw_data' => ['Firma' => 'Test AG'],
            'status' => 'pending',
        ]);

        $mockJson = json_encode([
            [
                'id' => $row->id,
                'company_fields' => ['company_name' => 'Test AG'],
                'contact_fields' => [],
                'confidence' => 0.9,
            ],
        ]);

        Http::fake([
            'api.edenai.run/*' => function ($request) {
                // Assert the custom system prompt from the database was used in the HTTP payload
                $body = $request->data();
                $systemSent = $body['messages'][0]['content'] ?? '';
                if (str_contains($systemSent, 'CUSTOM SYSTEM PROMPT IDENTIFIER 12345')) {
                    return Http::response([
                        'choices' => [['message' => ['content' => '[{"id":"1","company_fields":{}}]']]],
                    ], 200);
                }
                return Http::response(['error' => 'Wrong prompt'], 500);
            },
        ]);

        $res = $this->postJson("/api/raw-imports/{$batch->id}/normalize", [
            'sample_percent' => 100,
        ]);

        $res->assertStatus(200);
    }
}

<?php

namespace Tests\Feature;

use App\Models\ImportBatch;
use App\Models\RawImport;
use App\Models\User;
use App\Services\EdenAiService;
use App\Services\RawImportNormalizerService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

class LlmNormalizerTest extends TestCase
{
    use RefreshDatabase;

    public function test_llm_normalization_splits_contact_centric_rows(): void
    {
        $batch = ImportBatch::create([
            'id' => (string) Str::uuid(),
            'label' => 'Contact Heavy List',
            'status' => 'pending',
            'total_rows' => 1,
        ]);

        $row = RawImport::create([
            'id' => (string) Str::uuid(),
            'import_batch_id' => $batch->id,
            'source_row_index' => 0,
            'raw_data' => [
                'Full Name' => 'Dr. Michael Weber',
                'Business Email' => 'm.weber@bavaria-medical.de',
                'Organisation' => 'Bavaria Medical Systems AG',
                'City' => 'München',
                'Title' => 'Head of Sales',
            ],
            'status' => 'pending',
        ]);

        // Mock Eden AI endpoint
        $mockJson = json_encode([
            [
                'id' => $row->id,
                'company_fields' => [
                    'company_name' => 'Bavaria Medical Systems AG',
                    'domain' => 'bavaria-medical.de',
                    'city' => 'München',
                ],
                'contact_fields' => [
                    'first_name' => 'Michael',
                    'last_name' => 'Weber',
                    'email' => 'm.weber@bavaria-medical.de',
                    'position' => 'Head of Sales',
                ],
                'extra' => [],
                'confidence' => 0.96,
                'notes' => 'Sichere Trennung von Ansprechpartner und Organisation',
            ],
        ]);

        Http::fake([
            'api.edenai.run/*' => Http::response([
                'choices' => [
                    [
                        'message' => [
                            'content' => $mockJson,
                        ],
                    ],
                ],
                'usage' => ['total_tokens' => 150],
            ], 200),
        ]);

        $service = app(RawImportNormalizerService::class);
        $service->normalizeBatch($batch, 'test-eden-key', 'us', 100);

        $row->refresh();
        $this->assertEquals('normalized', $row->status);
        $this->assertEquals(0.96, $row->confidence_score);
        $this->assertEquals('Bavaria Medical Systems AG', $row->normalized_data['company_fields']['company_name']);
        $this->assertEquals('bavaria-medical.de', $row->normalized_data['company_fields']['domain']);
        $this->assertEquals('Michael', $row->normalized_data['contact_fields']['first_name']);
        $this->assertEquals('Weber', $row->normalized_data['contact_fields']['last_name']);
        $this->assertEquals('Head of Sales', $row->normalized_data['contact_fields']['position']);

        // Assert raw data is unchanged
        $this->assertEquals('Dr. Michael Weber', $row->raw_data['Full Name']);
    }

    public function test_sample_normalization_only_processes_given_percentage(): void
    {
        $batch = ImportBatch::create([
            'id' => (string) Str::uuid(),
            'label' => 'Sample Test Batch',
            'status' => 'pending',
            'total_rows' => 10,
        ]);

        for ($i = 0; $i < 10; $i++) {
            RawImport::create([
                'id' => (string) Str::uuid(),
                'import_batch_id' => $batch->id,
                'source_row_index' => $i,
                'raw_data' => ['Name' => "Firma $i", 'Domain' => "firma$i.de"],
                'status' => 'pending',
            ]);
        }

        $service = app(RawImportNormalizerService::class);
        // Normalize 10% (1 out of 10 rows)
        $service->normalizeBatch($batch, null, 'us', 10);

        $normalizedCount = RawImport::where('import_batch_id', $batch->id)->where('status', 'normalized')->count();
        $pendingCount = RawImport::where('import_batch_id', $batch->id)->where('status', 'pending')->count();

        $this->assertEquals(1, $normalizedCount);
        $this->assertEquals(9, $pendingCount);
    }
}

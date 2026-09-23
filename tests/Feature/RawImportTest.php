<?php

namespace Tests\Feature;

use App\Jobs\NormalizeBatchJob;
use App\Models\DataCase;
use App\Models\ImportBatch;
use App\Models\RawImport;
use App\Models\Row;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class RawImportTest extends TestCase
{
    use RefreshDatabase;

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

        $this->actingAs($this->admin);
        Sanctum::actingAs($this->admin, ['*']);
    }

    public function test_csv_upload_creates_raw_batch_and_immutable_rows(): void
    {
        $csv = "company_name,domain,ansprechpartner,email\n"
            . "Hotel Seeblick,seeblick.de,Max Mustermann,max@seeblick.de\n"
            . "Alpenrose Resort,alpenrose.at,Erika Muster,info@alpenrose.at";

        $file = UploadedFile::fake()->createWithContent('hotels.csv', $csv);

        $response = $this->actingAs($this->admin)->postJson('/api/raw-imports', [
            'file' => $file,
            'label' => 'Hotels Test',
        ]);

        $response->assertStatus(201)
            ->assertJsonStructure(['batch_id', 'total_rows', 'status']);

        $batchId = $response->json('batch_id');

        $this->assertDatabaseHas('import_batches', [
            'id' => $batchId,
            'total_rows' => 2,
            'status' => 'pending',
        ]);

        $this->assertDatabaseCount('raw_imports', 2);

        $firstRow = RawImport::where('import_batch_id', $batchId)->first();
        $this->assertEquals('pending', $firstRow->status);
        $this->assertNotNull($firstRow->raw_data);
        $this->assertEquals('Hotel Seeblick', $firstRow->raw_data['company_name']);
        $this->assertNull($firstRow->normalized_data);
    }

    public function test_deterministic_normalization_splits_company_and_contact(): void
    {
        $batch = ImportBatch::create([
            'id' => (string) \Illuminate\Support\Str::uuid(),
            'label' => 'Test Batch',
            'status' => 'pending',
            'total_rows' => 1,
        ]);

        RawImport::create([
            'id' => (string) \Illuminate\Support\Str::uuid(),
            'import_batch_id' => $batch->id,
            'source_row_index' => 0,
            'raw_data' => [
                'Firma' => 'Muster Hotel GmbH',
                'Website' => 'https://muster-hotel.de',
                'Vorname' => 'Anna',
                'Nachname' => 'Schmidt',
                'Position' => 'Geschäftsführung',
                'E-Mail' => 'anna@muster-hotel.de',
            ],
            'status' => 'pending',
        ]);

        // Call normalize without API key -> triggers deterministic rule fallback
        $response = $this->actingAs($this->admin)->postJson("/api/raw-imports/{$batch->id}/normalize", [
            'sample_percent' => 100,
        ]);

        $response->assertStatus(200);

        $row = RawImport::where('import_batch_id', $batch->id)->first();
        $this->assertEquals('normalized', $row->status);
        $this->assertNotNull($row->normalized_data);

        // Assert company fields
        $this->assertEquals('Muster Hotel GmbH', $row->normalized_data['company_fields']['company_name']);
        $this->assertEquals('muster-hotel.de', $row->normalized_data['company_fields']['domain']);

        // Assert contact fields
        $this->assertEquals('Anna', $row->normalized_data['contact_fields']['first_name']);
        $this->assertEquals('Schmidt', $row->normalized_data['contact_fields']['last_name']);
        $this->assertEquals('Geschäftsführung', $row->normalized_data['contact_fields']['position']);

        // Raw data remains COMPLETELY intact and immutable
        $this->assertEquals('Muster Hotel GmbH', $row->raw_data['Firma']);
    }

    public function test_promote_and_rollback_flow(): void
    {
        $case = DataCase::create([
            'id' => (string) \Illuminate\Support\Str::uuid(),
            'name' => 'Ziel-Case',
        ]);

        $batch = ImportBatch::create([
            'id' => (string) \Illuminate\Support\Str::uuid(),
            'label' => 'Promote Test Batch',
            'status' => 'normalized',
            'total_rows' => 1,
            'normalized_rows' => 1,
        ]);

        RawImport::create([
            'id' => (string) \Illuminate\Support\Str::uuid(),
            'import_batch_id' => $batch->id,
            'source_row_index' => 0,
            'raw_data' => ['Firma' => 'Alpha AG', 'Vorname' => 'Hans'],
            'normalized_data' => [
                'company_fields' => ['company_name' => 'Alpha AG', 'domain' => 'alpha.de'],
                'contact_fields' => ['first_name' => 'Hans', 'last_name' => 'Bauer'],
            ],
            'confidence_score' => 0.95,
            'status' => 'normalized',
        ]);

        // 1. Promote
        $promoteRes = $this->actingAs($this->admin)->postJson("/api/raw-imports/{$batch->id}/promote", [
            'case_id' => $case->id,
        ]);

        $promoteRes->assertStatus(200);

        $this->assertDatabaseHas('rows', [
            'case_id' => $case->id,
            'import_batch_id' => $batch->id,
        ]);

        $this->assertDatabaseHas('contact_rows', [
            'case_id' => $case->id,
            'import_batch_id' => $batch->id,
        ]);

        $batch->refresh();
        $this->assertEquals('promoted', $batch->status);

        // 2. Rollback
        $rollbackRes = $this->actingAs($this->admin)->postJson("/api/raw-imports/{$batch->id}/rollback");
        $rollbackRes->assertStatus(200);

        $this->assertDatabaseMissing('rows', ['import_batch_id' => $batch->id]);
        $this->assertDatabaseMissing('contact_rows', ['import_batch_id' => $batch->id]);

        $batch->refresh();
        $this->assertEquals('normalized', $batch->status);
    }

    public function test_large_batch_dispatches_queue_job(): void
    {
        Queue::fake();

        $batch = ImportBatch::create([
            'id' => (string) \Illuminate\Support\Str::uuid(),
            'label' => 'Large Batch',
            'status' => 'pending',
            'total_rows' => 600, // >= 500 triggers queue
        ]);

        $response = $this->actingAs($this->admin)->postJson("/api/raw-imports/{$batch->id}/normalize");

        $response->assertStatus(200)
            ->assertJson(['queued' => true]);

        Queue::assertPushed(NormalizeBatchJob::class, function ($job) use ($batch) {
            return $job->batchId === $batch->id;
        });
    }
}

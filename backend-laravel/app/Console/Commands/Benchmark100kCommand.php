<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Models\DataCase;
use App\Models\Row;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\DB;

class Benchmark100kCommand extends Command
{
    protected $signature = 'dataminer:benchmark {--count=10000 : Number of test rows to generate}';
    protected $description = 'Generates benchmark rows to test PostgreSQL bulk insert and 100k throughput';

    public function handle(): int
    {
        $count = (int) $this->option('count');
        $this->info("=== DataMiner Benchmark: Erzeuge {$count} Testzeilen ===");

        $case = DataCase::firstOrCreate(
            ['name' => '100k Benchmark Case'],
            [
                'id' => (string) Str::uuid(),
                'description' => 'Synthetischer Lasttest für 100k-Scaling-Architektur',
                'columns' => [
                    ['id' => 'c1', 'key' => 'company_name', 'label' => 'Firma'],
                    ['id' => 'c2', 'key' => 'website', 'label' => 'Website'],
                    ['id' => 'c3', 'key' => 'city', 'label' => 'Stadt'],
                    ['id' => 'c4', 'key' => 'status', 'label' => 'Status'],
                ],
                'tags' => ['benchmark', '100k'],
            ]
        );

        $this->line("Target Case: {$case->id} ({$case->name})");

        $batchSize = 1000;
        $batches = ceil($count / $batchSize);
        $totalInserted = 0;
        $start = microtime(true);

        $bar = $this->output->createProgressBar($count);
        $bar->start();

        for ($b = 0; $b < $batches; $b++) {
            $batch = [];
            $currentBatchSize = min($batchSize, $count - $totalInserted);

            for ($i = 0; $i < $currentBatchSize; $i++) {
                $idx = $totalInserted + $i;
                $batch[] = [
                    'id' => (string) Str::uuid(),
                    'case_id' => $case->id,
                    'row_index' => $idx,
                    'data' => json_encode([
                        'company_name' => "Benchmark Company #{$idx}",
                        'website' => "https://company-{$idx}.test",
                        'city' => ($idx % 2 === 0) ? 'Berlin' : 'München',
                        'status' => 'pending',
                    ]),
                    'cell_statuses' => json_encode([]),
                    'cell_errors' => json_encode([]),
                    'created_at' => now(),
                    'updated_at' => now(),
                ];
            }

            Row::insert($batch);
            $totalInserted += $currentBatchSize;
            $bar->advance($currentBatchSize);
        }

        $bar->finish();
        $this->newLine();

        $duration = round(microtime(true) - $start, 2);
        $throughput = round($count / max($duration, 0.001), 0);

        $this->info("✔ {$count} Zeilen erfolgreich generiert in {$duration}s!");
        $this->line("  Durchsatz Bulk-Insert: <info>{$throughput} Zeilen/Sekunde</info>");

        $totalInDb = Row::count();
        $this->line("  Gesamtzahl Zeilen in DB: " . number_format($totalInDb, 0, ',', '.'));

        return 0;
    }
}

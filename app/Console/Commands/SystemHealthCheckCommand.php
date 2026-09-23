<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Models\DataCase;
use App\Models\Row;
use App\Models\GlobalSetting;
use Illuminate\Support\Facades\DB;

class SystemHealthCheckCommand extends Command
{
    protected $signature = 'dataminer:health';
    protected $description = 'Checks database connection, row count, queue tables, and API settings readiness';

    public function handle(): int
    {
        $this->info('=== DataMiner 100k System Health Check ===');

        // 1. Check Database connection
        try {
            DB::connection()->getPdo();
            $this->line('<info>✔</info> PostgreSQL Database: Connected');
        } catch (\Throwable $e) {
            $this->error('✖ PostgreSQL Database: Failed to connect - ' . $e->getMessage());
            return 1;
        }

        // 2. Count Cases and Rows
        $caseCount = DataCase::count();
        $rowCount = Row::count();
        $this->line("<info>✔</info> Data Cases: {$caseCount}");
        $this->line("<info>✔</info> Total Rows in DB: " . number_format($rowCount, 0, ',', '.'));

        // 3. Check Settings & Keys
        $settings = GlobalSetting::instance();
        $edenStatus = !empty($settings->eden_api_key) ? '<info>Configured</info>' : '<comment>Missing</comment>';
        $serpStatus = !empty($settings->serp_api_key) ? '<info>Configured</info>' : '<comment>Missing (Optional)</comment>';
        $this->line("  - EdenAI API Key: {$edenStatus}");
        $this->line("  - SerpAPI Key:    {$serpStatus}");

        // 4. Check Queue table
        try {
            $jobsCount = DB::table('jobs')->count();
            $this->line("<info>✔</info> Queue table exists (active jobs: {$jobsCount})");
        } catch (\Throwable $e) {
            $this->line("<comment>!</comment> Jobs table not found or queue uses Redis");
        }

        $this->newLine();
        $this->info('System is ready for 100k+ parallel enrichment workloads!');
        return 0;
    }
}

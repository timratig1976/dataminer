<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        if (!Schema::hasTable('cases')) {
            Schema::create('cases', function (Blueprint $table) {
                $table->string('id')->primary();
                $table->string('name');
                $table->jsonb('ai_columns')->default('[]');
                $table->string('eden_api_key')->nullable();
                $table->string('eden_region')->default('us');
                $table->jsonb('model_allowlist')->default('[]');
                $table->jsonb('col_order')->default('[]');
                $table->timestampsTz();
            });
        }

        if (!Schema::hasTable('rows')) {
            Schema::create('rows', function (Blueprint $table) {
                $table->string('id')->primary();
                $table->string('case_id')->index();
                $table->integer('row_index');
                $table->jsonb('data')->default('{}');
                $table->jsonb('cell_statuses')->default('{}');
                $table->jsonb('cell_errors')->default('{}');
                $table->timestampsTz();

                $table->foreign('case_id')->references('id')->on('cases')->onDelete('cascade');
                $table->index(['case_id', 'row_index'], 'idx_rows_case_id');
            });
        }

        if (!Schema::hasTable('contact_rows')) {
            Schema::create('contact_rows', function (Blueprint $table) {
                $table->string('id')->primary();
                $table->string('case_id')->index();
                $table->string('company_row_id')->nullable()->index();
                $table->integer('row_index')->default(0);
                $table->jsonb('data')->default('{}');
                $table->jsonb('cell_statuses')->default('{}');
                $table->jsonb('cell_errors')->default('{}');
                $table->timestampsTz();

                $table->foreign('case_id')->references('id')->on('cases')->onDelete('cascade');
            });
        }

        if (!Schema::hasTable('agent_runs')) {
            Schema::create('agent_runs', function (Blueprint $table) {
                $table->string('id')->primary();
                $table->string('case_id')->index();
                $table->jsonb('goal');
                $table->string('status')->default('planning')->index();
                $table->jsonb('state');
                $table->timestampsTz();

                $table->foreign('case_id')->references('id')->on('cases')->onDelete('cascade');
            });
        }

        if (!Schema::hasTable('scrape_cache')) {
            Schema::create('scrape_cache', function (Blueprint $table) {
                $table->string('url')->primary();
                $table->text('markdown');
                $table->string('title')->nullable();
                $table->timestampTz('fetched_at');
            });
        }

        if (!Schema::hasTable('settings')) {
            Schema::create('settings', function (Blueprint $table) {
                $table->string('id')->primary()->default('global');
                $table->string('eden_api_key')->nullable();
                $table->string('eden_region')->default('us');
                $table->jsonb('model_allowlist')->default('[]');
                $table->jsonb('catalog_domains')->default('[]');
                $table->string('serper_api_key')->nullable();
                $table->string('serp_api_key')->nullable();
                $table->string('brave_api_key')->nullable();
                $table->string('apify_api_token')->nullable();
                $table->string('firecrawl_api_key')->nullable();
                $table->text('planner_system_prompt')->nullable();
                $table->timestampsTz();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('rows');
        Schema::dropIfExists('contact_rows');
        Schema::dropIfExists('agent_runs');
        Schema::dropIfExists('cases');
        Schema::dropIfExists('scrape_cache');
        Schema::dropIfExists('settings');
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('normalization_prompts', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('name');
            $table->text('description')->nullable();
            $table->string('schema_type', 30)->default('*');
            $table->text('system_prompt');
            $table->text('user_prompt_template');
            $table->string('model', 50)->default('openai/gpt-4o');
            $table->integer('max_tokens')->default(4000);
            $table->float('temperature')->default(0.0);
            $table->integer('max_rows_per_chunk')->default(10);
            $table->boolean('is_active')->default(false);
            $table->integer('version')->default(1);
            $table->timestamps();

            $table->index(['schema_type', 'is_active']);
        });

        Schema::create('batch_evaluation_runs', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('import_batch_id')->index();
            $table->string('prompt_id')->nullable()->index();
            $table->integer('sample_percent')->default(10);
            $table->integer('rows_processed')->default(0);
            $table->integer('rows_normalized')->default(0);
            $table->integer('rows_error')->default(0);
            $table->float('avg_confidence')->nullable();
            $table->integer('conf_high_count')->default(0);
            $table->integer('conf_mid_count')->default(0);
            $table->integer('conf_low_count')->default(0);
            $table->jsonb('hallucination_flags')->default('[]');
            $table->integer('tokens_used')->nullable();
            $table->float('cost_usd')->nullable();
            $table->integer('duration_ms')->nullable();
            $table->string('status', 20)->default('running');
            $table->timestamps();

            $table->foreign('import_batch_id')->references('id')->on('import_batches')->onDelete('cascade');
            $table->foreign('prompt_id')->references('id')->on('normalization_prompts')->onDelete('set null');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('batch_evaluation_runs');
        Schema::dropIfExists('normalization_prompts');
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('import_batches', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('label');
            $table->string('case_id')->nullable()->index();
            $table->string('status', 20)->default('pending'); // pending, normalizing, normalized, promoted, error
            $table->integer('total_rows')->default(0);
            $table->integer('normalized_rows')->default(0);
            $table->integer('promoted_rows')->default(0);
            $table->string('schema_type', 30)->nullable(); // contact-first, company-first, mixed
            $table->timestamps();

            $table->foreign('case_id')->references('id')->on('cases')->onDelete('set null');
        });

        Schema::create('raw_imports', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('import_batch_id')->index();
            $table->string('case_id')->nullable()->index();
            $table->string('batch_label')->nullable();
            $table->integer('source_row_index')->default(0);
            $table->jsonb('raw_data')->default('{}');
            $table->jsonb('normalized_data')->nullable();
            $table->string('status', 20)->default('pending'); // pending, normalizing, normalized, promoted, skipped, error
            $table->float('confidence_score')->nullable();
            $table->text('ai_notes')->nullable();
            $table->string('schema_type', 30)->nullable();
            $table->timestamps();

            $table->foreign('import_batch_id')->references('id')->on('import_batches')->onDelete('cascade');
            $table->foreign('case_id')->references('id')->on('cases')->onDelete('set null');
            $table->index(['import_batch_id', 'status']);
        });

        // Add import_batch_id to rows and contact_rows for clean rollback
        Schema::table('rows', function (Blueprint $table) {
            $table->string('import_batch_id')->nullable()->index();
        });

        Schema::table('contact_rows', function (Blueprint $table) {
            $table->string('import_batch_id')->nullable()->index();
        });
    }

    public function down(): void
    {
        Schema::table('contact_rows', function (Blueprint $table) {
            $table->dropColumn('import_batch_id');
        });

        Schema::table('rows', function (Blueprint $table) {
            $table->dropColumn('import_batch_id');
        });

        Schema::dropIfExists('raw_imports');
        Schema::dropIfExists('import_batches');
    }
};

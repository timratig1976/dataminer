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
        Schema::create('enrichment_jobs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('case_id')->index();
            $table->string('column_id');
            $table->string('tool'); // batch_company, batch_contact, etc.
            $table->string('status')->default('pending')->index(); // pending, running, paused, completed, failed
            $table->integer('total_rows')->default(0);
            $table->integer('processed_rows')->default(0);
            $table->integer('failed_rows')->default(0);
            $table->text('error')->nullable();
            $table->jsonb('config')->nullable();
            $table->timestamps();

            $table->foreign('case_id')->references('id')->on('cases')->onDelete('cascade');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('enrichment_jobs');
    }
};

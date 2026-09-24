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
        Schema::table('cases', function (Blueprint $table) {
            $table->text('relevance_prompt')->nullable();
            $table->string('relevance_status')->default('idle'); // idle, running, completed, failed
            $table->integer('relevance_total')->default(0);
            $table->integer('relevance_processed')->default(0);
            $table->integer('relevance_atypic_count')->default(0);
            $table->timestamp('relevance_last_run_at')->nullable();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('cases', function (Blueprint $table) {
            $table->dropColumn([
                'relevance_prompt',
                'relevance_status',
                'relevance_total',
                'relevance_processed',
                'relevance_atypic_count',
                'relevance_last_run_at',
            ]);
        });
    }
};

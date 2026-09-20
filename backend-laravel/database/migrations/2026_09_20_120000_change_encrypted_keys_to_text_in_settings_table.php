<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('settings', function (Blueprint $table) {
            $table->text('eden_api_key')->nullable()->change();
            $table->text('serper_api_key')->nullable()->change();
            $table->text('serp_api_key')->nullable()->change();
            $table->text('brave_api_key')->nullable()->change();
            $table->text('apify_api_token')->nullable()->change();
            $table->text('firecrawl_api_key')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('settings', function (Blueprint $table) {
            $table->string('eden_api_key', 255)->nullable()->change();
            $table->string('serper_api_key', 255)->nullable()->change();
            $table->string('serp_api_key', 255)->nullable()->change();
            $table->string('brave_api_key', 255)->nullable()->change();
            $table->string('apify_api_token', 255)->nullable()->change();
            $table->string('firecrawl_api_key', 255)->nullable()->change();
        });
    }
};

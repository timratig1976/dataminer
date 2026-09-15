-- Migration 0005: Add search API keys and catalog domains to global settings
-- These columns were added in the search-API-key management feature (commit bd5a0af)

ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "catalog_domains" jsonb DEFAULT '[]'::jsonb;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "serper_api_key" text;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "serp_api_key" text;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "brave_api_key" text;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "apify_api_token" text;

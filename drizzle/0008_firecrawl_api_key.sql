-- Migration 0008: Add firecrawl_api_key to settings table for direct Firecrawl scraping & search
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "firecrawl_api_key" text;

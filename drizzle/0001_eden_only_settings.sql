CREATE TABLE "settings" (
	"id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"eden_api_key" text,
	"eden_region" text DEFAULT 'eu' NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cases" DROP COLUMN "api_key";--> statement-breakpoint
ALTER TABLE "cases" DROP COLUMN "cerebras_api_key";--> statement-breakpoint
ALTER TABLE "cases" DROP COLUMN "anthropic_api_key";
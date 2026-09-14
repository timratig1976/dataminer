CREATE TABLE "discovery_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"plan" jsonb,
	"steps_total" integer DEFAULT 0 NOT NULL,
	"steps_done" integer DEFAULT 0 NOT NULL,
	"rows_added" integer DEFAULT 0 NOT NULL,
	"rows_skipped" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cases" ALTER COLUMN "eden_region" SET DEFAULT 'us';--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "eden_region" SET DEFAULT 'us';--> statement-breakpoint
ALTER TABLE "discovery_jobs" ADD CONSTRAINT "discovery_jobs_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_discovery_jobs_case_id" ON "discovery_jobs" USING btree ("case_id");
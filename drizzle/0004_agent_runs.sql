CREATE TABLE "agent_runs" (
  "id" text PRIMARY KEY,
  "case_id" text NOT NULL REFERENCES "cases"("id") ON DELETE CASCADE,
  "goal" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'planning',
  "state" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);
CREATE INDEX "idx_agent_runs_case_id" ON "agent_runs" ("case_id");
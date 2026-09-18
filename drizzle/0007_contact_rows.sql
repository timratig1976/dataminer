-- Migration 0007: contact_rows table (Clay-pattern contacts table)
-- Each row = one contact/person found for a company row.
-- Linked via company_row_id (FK → rows.id, nullable for standalone contacts).

CREATE TABLE IF NOT EXISTS "contact_rows" (
  "id" TEXT PRIMARY KEY,
  "case_id" TEXT NOT NULL REFERENCES "cases"("id") ON DELETE CASCADE,
  "company_row_id" TEXT,
  "row_index" INTEGER NOT NULL DEFAULT 0,
  "data" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "cell_statuses" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "cell_errors" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_contact_rows_case_id" ON "contact_rows"("case_id", "row_index");
CREATE INDEX IF NOT EXISTS "idx_contact_rows_company_row_id" ON "contact_rows"("company_row_id");

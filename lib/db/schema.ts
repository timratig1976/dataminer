/**
 * lib/db/schema.ts
 * Drizzle schema for PostgreSQL (local dev via Homebrew, prod-ready for any PG).
 *
 * Upgraded from the old SQLite design:
 *   - JSON columns are now real JSONB (queryable/indexable, e.g. rows.data->>'city')
 *   - timestamps are timestamptz instead of ISO text
 *   - logs.id is a native identity column
 */

import { pgTable, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import type { AiColumn, CellStatus } from "../types";

export const cases = pgTable("cases", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  aiColumns: jsonb("ai_columns").$type<AiColumn[]>().notNull().default([]),
  apiKey: text("api_key"),
  cerebrasApiKey: text("cerebras_api_key"),
  anthropicApiKey: text("anthropic_api_key"),
  edenApiKey: text("eden_api_key"),
  edenRegion: text("eden_region").notNull().default("eu"),
  modelAllowlist: jsonb("model_allowlist").$type<string[]>().notNull().default([]),
  colOrder: jsonb("col_order").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const rows = pgTable(
  "rows",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    rowIndex: integer("row_index").notNull(),
    data: jsonb("data").$type<Record<string, string | null>>().notNull().default({}),
    cellStatuses: jsonb("cell_statuses").$type<Record<string, CellStatus>>().notNull().default({}),
    cellErrors: jsonb("cell_errors").$type<Record<string, string>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("idx_rows_case_id").on(t.caseId, t.rowIndex)]
);

export const logs = pgTable(
  "logs",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    caseId: text("case_id").notNull(),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("idx_logs_case_id").on(t.caseId, t.id)]
);

export const scrapeCache = pgTable("scrape_cache", {
  url: text("url").primaryKey(),
  markdown: text("markdown").notNull(),
  title: text("title"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
});

export const apolloCache = pgTable("apollo_cache", {
  lookupKey: text("lookup_key").primaryKey(),
  payload: jsonb("payload").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
});

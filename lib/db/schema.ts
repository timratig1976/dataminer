/**
 * lib/db/schema.ts
 * Drizzle schema for PostgreSQL (local dev via Homebrew, prod-ready for any PG).
 *
 * Upgraded from the old SQLite design:
 *   - JSON columns are now real JSONB (queryable/indexable, e.g. rows.data->>'city')
 *   - timestamps are timestamptz instead of ISO text
 *   - logs.id is a native identity column
 */

import { pgTable, text, integer, jsonb, timestamp, index, boolean } from "drizzle-orm/pg-core";
import type { AiColumn, CellStatus } from "../types";

export const cases = pgTable("cases", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  aiColumns: jsonb("ai_columns").$type<AiColumn[]>().notNull().default([]),
  edenApiKey: text("eden_api_key"),
  edenRegion: text("eden_region").notNull().default("us"),
  modelAllowlist: jsonb("model_allowlist").$type<string[]>().notNull().default([]),
  colOrder: jsonb("col_order").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

/**
 * Global app settings (single row, id='global').
 * Eden AI is the only LLM provider: one global key + region; a case-level
 * edenApiKey overrides the global key when set. EDEN_API_KEY env is the
 * last-resort fallback.
 */
export const settings = pgTable("settings", {
  id: text("id").primaryKey().default("global"),
  edenApiKey: text("eden_api_key"),
  edenRegion: text("eden_region").notNull().default("us"),
  modelAllowlist: jsonb("model_allowlist").$type<string[]>().default([]),
  /** Learned catalog domains accumulated across all runs */
  catalogDomains: jsonb("catalog_domains").$type<string[]>().default([]),
  /** Search API keys (encrypted at rest) */
  serperApiKey: text("serper_api_key"),
  serpApiKey: text("serp_api_key"),
  braveApiKey: text("brave_api_key"),
  apifyApiToken: text("apify_api_token"),
  /** Overridable planner system prompt. If null, planner.ts uses its built-in default. */
  plannerSystemPrompt: text("planner_system_prompt"),
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

// ── Discovery jobs ─────────────────────────────────────────────────────────

export const discoveryJobs = pgTable(
  "discovery_jobs",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"), // pending|running|done|error
    plan: jsonb("plan"),         // DiscoveryPlan JSON
    stepsTotal: integer("steps_total").notNull().default(0),
    stepsDone: integer("steps_done").notNull().default(0),
    rowsAdded: integer("rows_added").notNull().default(0),
    rowsSkipped: integer("rows_skipped").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("idx_discovery_jobs_case_id").on(t.caseId)]
);

// ── Agent goal runs ─────────────────────────────────────────────────────────

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    goal: jsonb("goal").notNull(),
    status: text("status").notNull().default("planning"),
    state: jsonb("state").notNull(),   // full AgentRunState (plan, stepResults, counts, etc.)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("idx_agent_runs_case_id").on(t.caseId)]
);

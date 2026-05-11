import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import type { Case, RowData } from "./types";
import { decryptSecret, encryptSecret, maskSecret } from "./secrets";

const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "dataminer.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  initSchema(_db);
  return _db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cases (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      ai_columns TEXT NOT NULL DEFAULT '[]',
      api_key TEXT,
      cerebras_api_key TEXT,
      anthropic_api_key TEXT,
      model_allowlist TEXT NOT NULL DEFAULT '[]',
      col_order TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rows (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      row_index INTEGER NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      cell_statuses TEXT NOT NULL DEFAULT '{}',
      cell_errors TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_rows_case_id ON rows(case_id, row_index);
    CREATE INDEX IF NOT EXISTS idx_logs_case_id ON logs(case_id, id DESC);
  `);
  // migrate existing DBs that don't have col_order yet
  try { db.exec(`ALTER TABLE cases ADD COLUMN col_order TEXT NOT NULL DEFAULT '[]'`); } catch {}
  try { db.exec(`ALTER TABLE cases ADD COLUMN cerebras_api_key TEXT`); } catch {}
  try { db.exec(`ALTER TABLE cases ADD COLUMN anthropic_api_key TEXT`); } catch {}
  try { db.exec(`ALTER TABLE cases ADD COLUMN model_allowlist TEXT NOT NULL DEFAULT '[]'`); } catch {}
}

// ── Cases ────────────────────────────────────────────────────────────────────

export function listCases(): Case[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM cases ORDER BY updated_at DESC").all() as any[];
  return rows.map(deserializeCase);
}

export function getCase(id: string): Case | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM cases WHERE id = ?").get(id) as any;
  return row ? deserializeCase(row) : null;
}

export function createCase(c: Omit<Case, "createdAt" | "updatedAt">): Case {
  const db = getDb();
  const now = new Date().toISOString();
  const encryptedApiKey = encryptSecret(c.apiKey);
  const encryptedCerebrasApiKey = encryptSecret(c.cerebrasApiKey);
  const encryptedAnthropicApiKey = encryptSecret(c.anthropicApiKey);
  db.prepare(`
    INSERT INTO cases (id, name, ai_columns, api_key, cerebras_api_key, anthropic_api_key, model_allowlist, col_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(c.id, c.name, JSON.stringify(c.aiColumns), encryptedApiKey, encryptedCerebrasApiKey, encryptedAnthropicApiKey, JSON.stringify(c.modelAllowlist ?? []), JSON.stringify(c.colOrder ?? []), now, now);
  return getCase(c.id)!;
}

export function updateCase(id: string, patch: Partial<Omit<Case, "id" | "createdAt">>): Case | null {
  const db = getDb();
  const existing = getCase(id);
  if (!existing) return null;
  const nextApiKey = patch.apiKey !== undefined
    ? encryptSecret(patch.apiKey)
    : encryptSecret(existing.apiKey);
  const nextCerebrasApiKey = patch.cerebrasApiKey !== undefined
    ? encryptSecret(patch.cerebrasApiKey)
    : encryptSecret(existing.cerebrasApiKey);
  const nextAnthropicApiKey = patch.anthropicApiKey !== undefined
    ? encryptSecret(patch.anthropicApiKey)
    : encryptSecret(existing.anthropicApiKey);
  const merged = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  db.prepare(`
    UPDATE cases SET name=?, ai_columns=?, api_key=?, cerebras_api_key=?, anthropic_api_key=?, model_allowlist=?, col_order=?, updated_at=? WHERE id=?
  `).run(merged.name, JSON.stringify(merged.aiColumns), nextApiKey, nextCerebrasApiKey, nextAnthropicApiKey, JSON.stringify(merged.modelAllowlist ?? []), JSON.stringify(merged.colOrder ?? []), merged.updatedAt, id);
  return getCase(id)!;
}

export function getEffectiveApiKey(c: Case, provider: "openai" | "cerebras" | "anthropic" = "openai"): string | undefined {
  if (provider === "cerebras") {
    return c.cerebrasApiKey || process.env.CEREBRAS_API_KEY || undefined;
  }
  if (provider === "anthropic") {
    return c.anthropicApiKey || process.env.ANTHROPIC_API_KEY || undefined;
  }
  return c.apiKey || process.env.OPENAI_API_KEY || undefined;
}

export function deleteCase(id: string): void {
  getDb().prepare("DELETE FROM cases WHERE id = ?").run(id);
}

// ── Rows ─────────────────────────────────────────────────────────────────────

export function listRows(caseId: string): RowData[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM rows WHERE case_id = ? ORDER BY row_index ASC").all(caseId) as any[];
  return rows.map(deserializeRow);
}

export function getRow(id: string): RowData | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM rows WHERE id = ?").get(id) as any;
  return row ? deserializeRow(row) : null;
}

export function upsertRow(r: RowData): RowData {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO rows (id, case_id, row_index, data, cell_statuses, cell_errors, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      data=excluded.data,
      cell_statuses=excluded.cell_statuses,
      cell_errors=excluded.cell_errors,
      updated_at=excluded.updated_at
  `).run(
    r.id, r.caseId, r.rowIndex,
    JSON.stringify(r.data),
    JSON.stringify(r.cellStatuses),
    JSON.stringify(r.cellErrors),
    r.createdAt || now, now
  );
  return getRow(r.id)!;
}

export function updateRowCell(rowId: string, outputKey: string, value: string, status: string, error?: string): void {
  const db = getDb();
  const row = db.prepare("SELECT * FROM rows WHERE id = ?").get(rowId) as any;
  if (!row) return;
  const data = JSON.parse(row.data);
  const statuses = JSON.parse(row.cell_statuses);
  const errors = JSON.parse(row.cell_errors);
  data[outputKey] = value;
  statuses[outputKey] = status;
  if (error) errors[outputKey] = error;
  else delete errors[outputKey];
  db.prepare(`UPDATE rows SET data=?, cell_statuses=?, cell_errors=?, updated_at=? WHERE id=?`)
    .run(JSON.stringify(data), JSON.stringify(statuses), JSON.stringify(errors), new Date().toISOString(), rowId);
}

export function deleteRow(id: string): void {
  getDb().prepare("DELETE FROM rows WHERE id = ?").run(id);
}

export function deleteRowsByCase(caseId: string): void {
  getDb().prepare("DELETE FROM rows WHERE case_id = ?").run(caseId);
}

export function bulkInsertRows(rows: RowData[]): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO rows (id, case_id, row_index, data, cell_statuses, cell_errors, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at
  `);
  const now = new Date().toISOString();
  const insert = db.transaction((rows: RowData[]) => {
    for (const r of rows) {
      stmt.run(r.id, r.caseId, r.rowIndex, JSON.stringify(r.data), JSON.stringify(r.cellStatuses), JSON.stringify(r.cellErrors), now, now);
    }
  });
  insert(rows);
}

// ── Logs ─────────────────────────────────────────────────────────────────────

export function appendLog(caseId: string, message: string): void {
  getDb().prepare("INSERT INTO logs (case_id, message, created_at) VALUES (?, ?, ?)")
    .run(caseId, message, new Date().toISOString());
}

export function getLogs(caseId: string, limit = 200): { id: number; message: string; createdAt: string }[] {
  const rows = getDb()
    .prepare("SELECT id, message, created_at FROM logs WHERE case_id = ? ORDER BY id DESC LIMIT ?")
    .all(caseId, limit) as any[];
  return rows.map((r) => ({ id: r.id, message: r.message, createdAt: r.created_at })).reverse();
}

export function clearLogs(caseId: string): void {
  getDb().prepare("DELETE FROM logs WHERE case_id = ?").run(caseId);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function deserializeCase(row: any): Case {
  const decryptedApiKey = decryptSecret(row.api_key ?? undefined);
  const decryptedCerebrasApiKey = decryptSecret(row.cerebras_api_key ?? undefined);
  const decryptedAnthropicApiKey = decryptSecret(row.anthropic_api_key ?? undefined);
  return {
    id: row.id,
    name: row.name,
    aiColumns: JSON.parse(row.ai_columns || "[]"),
    apiKey: decryptedApiKey,
    apiKeyMasked: maskSecret(decryptedApiKey),
    cerebrasApiKey: decryptedCerebrasApiKey,
    cerebrasApiKeyMasked: maskSecret(decryptedCerebrasApiKey),
    anthropicApiKey: decryptedAnthropicApiKey,
    anthropicApiKeyMasked: maskSecret(decryptedAnthropicApiKey),
    modelAllowlist: JSON.parse(row.model_allowlist || "[]"),
    colOrder: JSON.parse(row.col_order || "[]"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function deserializeRow(row: any): RowData {
  return {
    id: row.id,
    caseId: row.case_id,
    rowIndex: row.row_index,
    data: JSON.parse(row.data || "{}"),
    cellStatuses: JSON.parse(row.cell_statuses || "{}"),
    cellErrors: JSON.parse(row.cell_errors || "{}"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

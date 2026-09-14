/**
 * lib/import-parser.ts
 * Parse CSV, XLSX and JSON files into row arrays.
 * No LLM calls — pure deterministic parsing.
 */

import Papa from "papaparse";
import * as XLSX from "xlsx";

export interface ParsedFile {
  headers: string[];
  rows: Record<string, string | null>[];
  rowCount: number;
  format: "csv" | "xlsx" | "json";
  error?: string;
}

// ── CSV ───────────────────────────────────────────────────────────────────────

function parseCsv(text: string): ParsedFile {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    transform: (v) => v.trim(),
  });

  if (result.errors.length && result.data.length === 0) {
    return { headers: [], rows: [], rowCount: 0, format: "csv", error: result.errors[0].message };
  }

  const headers = result.meta.fields ?? [];
  const rows = result.data.map((r) => {
    const out: Record<string, string | null> = {};
    for (const h of headers) out[h] = r[h] ?? null;
    return out;
  });

  return { headers, rows, rowCount: rows.length, format: "csv" };
}

// ── XLSX ──────────────────────────────────────────────────────────────────────

function parseXlsx(buffer: ArrayBuffer): ParsedFile {
  try {
    const wb = XLSX.read(buffer, { type: "buffer" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return { headers: [], rows: [], rowCount: 0, format: "xlsx", error: "Empty workbook" };

    const ws = wb.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
      defval: null,
      raw: false, // format dates etc. as strings
    });

    if (raw.length === 0) return { headers: [], rows: [], rowCount: 0, format: "xlsx" };

    const headers = Object.keys(raw[0]).map((h) => String(h).trim());
    const rows = raw.map((r) => {
      const out: Record<string, string | null> = {};
      for (const h of headers) {
        const v = r[h];
        out[h] = v != null ? String(v).trim() : null;
      }
      return out;
    });

    return { headers, rows, rowCount: rows.length, format: "xlsx" };
  } catch (e) {
    return { headers: [], rows: [], rowCount: 0, format: "xlsx", error: String(e) };
  }
}

// ── JSON ──────────────────────────────────────────────────────────────────────

function parseJson(text: string): ParsedFile {
  try {
    const parsed = JSON.parse(text);
    const arr: unknown[] = Array.isArray(parsed) ? parsed : parsed.rows ?? parsed.data ?? [];
    if (!Array.isArray(arr) || arr.length === 0) {
      return { headers: [], rows: [], rowCount: 0, format: "json", error: "No array found in JSON" };
    }

    const headers = [...new Set(arr.flatMap((r) => Object.keys(r as object)))];
    const rows = arr.map((r) => {
      const out: Record<string, string | null> = {};
      for (const h of headers) {
        const v = (r as Record<string, unknown>)[h];
        out[h] = v != null ? String(v).trim() : null;
      }
      return out;
    });

    return { headers, rows, rowCount: rows.length, format: "json" };
  } catch (e) {
    return { headers: [], rows: [], rowCount: 0, format: "json", error: `JSON parse error: ${e}` };
  }
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

/**
 * Parse a File (from FormData) into a uniform ParsedFile structure.
 * Supports .csv, .xlsx, .xls, .json
 */
export async function parseUploadedFile(file: File): Promise<ParsedFile> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

  if (ext === "json") {
    const text = await file.text();
    return parseJson(text);
  }

  if (ext === "csv" || ext === "tsv" || ext === "txt") {
    const text = await file.text();
    return parseCsv(text);
  }

  if (ext === "xlsx" || ext === "xls") {
    const buffer = await file.arrayBuffer();
    return parseXlsx(buffer);
  }

  // Fallback: try CSV
  const text = await file.text();
  return parseCsv(text);
}

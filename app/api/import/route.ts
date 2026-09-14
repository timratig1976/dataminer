import { NextRequest, NextResponse } from "next/server";
import { bulkInsertRows, updateCase, getCase, getExistingDomains } from "@/lib/db";
import { randomUUID } from "crypto";
import type { RowData } from "@/lib/types";
import { parseUploadedFile } from "@/lib/import-parser";
import { autoDetectMapping, normalizeRows } from "@/lib/row-normalizer";
import { normalizeDomain } from "@/lib/discovery";

export const runtime = "nodejs";

/**
 * POST /api/import
 *
 * Two modes:
 * A) File upload (multipart/form-data):
 *    { file, caseId, fieldMapping?, dedupeField?, skipDupes? }
 *
 * B) Legacy JSON body:
 *    { caseId, rows, columnKeys? }
 */
export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    return handleFileImport(req);
  }
  return handleJsonImport(req);
}

// ── File import ───────────────────────────────────────────────────────────────

async function handleFileImport(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const caseId = formData.get("caseId") as string | null;
  const rawMapping = formData.get("fieldMapping") as string | null;
  const dedupeField = (formData.get("dedupeField") as string | null) ?? "domain";
  const skipDupes = formData.get("skipDupes") !== "false"; // default true

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (!caseId) return NextResponse.json({ error: "caseId required" }, { status: 400 });

  const caseData = await getCase(caseId);
  if (!caseData) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  // Parse file
  const parsed = await parseUploadedFile(file);
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 422 });
  if (parsed.rows.length === 0) return NextResponse.json({ imported: 0, skipped: 0 });

  // Resolve field mapping (user-provided or auto-detected)
  let mapping = autoDetectMapping(parsed.headers);
  if (rawMapping) {
    try {
      const userMap: Record<string, string> = JSON.parse(rawMapping);
      // User mapping: originalKey → canonicalKey (overrides auto-detect)
      for (const [origKey, canonKey] of Object.entries(userMap)) {
        if (mapping[origKey]) {
          mapping[origKey] = { ...mapping[origKey], canonicalKey: canonKey };
        }
      }
    } catch {
      // ignore malformed mapping
    }
  }

  // Normalize rows to canonical keys
  const normalizedRows = normalizeRows(parsed.rows, mapping);

  // Dedupe
  let skipped = 0;
  let toInsert = normalizedRows;

  if (skipDupes && dedupeField === "domain") {
    const existingDomains = await getExistingDomains(caseId);
    const existingSet = new Set(existingDomains.map((d) => d.toLowerCase()));

    toInsert = normalizedRows.filter((r) => {
      const rawDomain = r["domain"];
      if (!rawDomain) return true;
      const normalized = rawDomain.includes("://")
        ? normalizeDomain(rawDomain)
        : rawDomain.toLowerCase().replace(/^www\./, "").trim();
      if (normalized && existingSet.has(normalized)) {
        skipped++;
        return false;
      }
      return true;
    });
  }

  if (toInsert.length === 0) return NextResponse.json({ imported: 0, skipped });

  // Get current max rowIndex
  const rowData: RowData[] = toInsert.map((r, i) => ({
    id: randomUUID(),
    caseId,
    rowIndex: i,
    data: r as Record<string, string>,
    cellStatuses: {},
    cellErrors: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  await bulkInsertRows(rowData);
  await updateCase(caseId, { updatedAt: new Date().toISOString() });

  return NextResponse.json({ imported: rowData.length, skipped });
}

// ── Legacy JSON import ────────────────────────────────────────────────────────

async function handleJsonImport(req: NextRequest) {
  const { caseId, rows, columnKeys } = await req.json();

  const caseData = await getCase(caseId);
  if (!caseData) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  const selectedColumns: string[] = Array.isArray(columnKeys)
    ? columnKeys.filter((k): k is string => typeof k === "string" && k.trim().length > 0)
    : [];

  const filteredRows: Record<string, string>[] = selectedColumns.length > 0
    ? rows.map((r: Record<string, string>) => {
        const next: Record<string, string> = {};
        for (const key of selectedColumns) {
          const value = r[key];
          if (value != null) next[key] = value;
        }
        return next;
      })
    : rows;

  const rowData: RowData[] = filteredRows.map((r: Record<string, string>, i: number) => ({
    id: randomUUID(),
    caseId,
    rowIndex: i,
    data: r,
    cellStatuses: {},
    cellErrors: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  await bulkInsertRows(rowData);

  if (selectedColumns.length) {
    await updateCase(caseId, { updatedAt: new Date().toISOString() });
  }

  return NextResponse.json({ imported: rowData.length });
}

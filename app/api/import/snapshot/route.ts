import { NextRequest, NextResponse } from "next/server";
import { createCase, bulkInsertRows, upsertContactRows } from "@/lib/db";
import { randomUUID } from "crypto";
import type { RowData } from "@/lib/types";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const snap = body as Record<string, unknown>;
  const version = snap._version;
  if (!snap.case || !Array.isArray(snap.rows)) {
    return NextResponse.json({ error: "Invalid snapshot format" }, { status: 400 });
  }

  const caseConfig = snap.case as { name: string; aiColumns: unknown[]; colOrder?: string[] };
  if (!caseConfig.name) {
    return NextResponse.json({ error: "Snapshot missing case name" }, { status: 400 });
  }

  const newCaseId = randomUUID();
  const now = new Date().toISOString();

  await createCase({
    id: newCaseId,
    name: caseConfig.name,
    aiColumns: Array.isArray(caseConfig.aiColumns) ? caseConfig.aiColumns as never : [],
    colOrder: Array.isArray(caseConfig.colOrder) ? caseConfig.colOrder : [],
  });

  const rowData: RowData[] = (snap.rows as Array<Record<string, unknown>>).map((r, i) => {
    // Support both v1 (plain data dict) and v2 (object with data, cellStatuses, cellErrors)
    const isV2 = r && typeof r === "object" && "data" in r && typeof r.data === "object";
    const data = isV2 ? (r.data as Record<string, string | null>) : (r as Record<string, string | null>);
    const cellStatuses = isV2 ? (r.cellStatuses as Record<string, import("@/lib/types").CellStatus> ?? {}) : {};
    const cellErrors = isV2 ? (r.cellErrors as Record<string, string> ?? {}) : {};

    return {
      id: randomUUID(),
      caseId: newCaseId,
      rowIndex: i,
      data,
      cellStatuses,
      cellErrors,
      createdAt: now,
      updatedAt: now,
    };
  });

  await bulkInsertRows(rowData);

  // Import contacts if present (v2)
  if (Array.isArray(snap.contacts) && snap.contacts.length > 0) {
    const rawContacts = snap.contacts.map((c: any) => (c && typeof c === "object" && "data" in c ? c.data : c));
    await upsertContactRows(newCaseId, "", rawContacts);
  }

  return NextResponse.json({ caseId: newCaseId, imported: rowData.length });
}

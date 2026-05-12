import { NextRequest, NextResponse } from "next/server";
import { createCase, bulkInsertRows } from "@/lib/db";
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
  if (snap._version !== 1 || !snap.case || !Array.isArray(snap.rows)) {
    return NextResponse.json({ error: "Invalid snapshot format" }, { status: 400 });
  }

  const caseConfig = snap.case as { name: string; aiColumns: unknown[] };
  if (!caseConfig.name) {
    return NextResponse.json({ error: "Snapshot missing case name" }, { status: 400 });
  }

  const newCaseId = randomUUID();
  const now = new Date().toISOString();

  createCase({
    id: newCaseId,
    name: caseConfig.name,
    aiColumns: Array.isArray(caseConfig.aiColumns) ? caseConfig.aiColumns as never : [],
  });

  const rowData: RowData[] = (snap.rows as Record<string, string>[]).map((data, i) => ({
    id: randomUUID(),
    caseId: newCaseId,
    rowIndex: i,
    data,
    cellStatuses: {},
    cellErrors: {},
    createdAt: now,
    updatedAt: now,
  }));

  bulkInsertRows(rowData);

  return NextResponse.json({ caseId: newCaseId, imported: rowData.length });
}

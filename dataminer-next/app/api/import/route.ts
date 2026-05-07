import { NextRequest, NextResponse } from "next/server";
import { bulkInsertRows, updateCase, getCase } from "@/lib/db";
import { randomUUID } from "crypto";
import type { RowData } from "@/lib/types";

export async function POST(req: NextRequest) {
  const { caseId, rows, columnKeys } = await req.json();

  const caseData = getCase(caseId);
  if (!caseData) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  const rowData: RowData[] = rows.map((r: Record<string, string>, i: number) => ({
    id: randomUUID(),
    caseId,
    rowIndex: i,
    data: r,
    cellStatuses: {},
    cellErrors: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  bulkInsertRows(rowData);

  if (columnKeys?.length) {
    updateCase(caseId, { updatedAt: new Date().toISOString() } as any);
  }

  return NextResponse.json({ imported: rowData.length });
}

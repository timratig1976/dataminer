import { NextRequest, NextResponse } from "next/server";
import { bulkInsertRows, updateCase, getCase } from "@/lib/db";
import { randomUUID } from "crypto";
import type { RowData } from "@/lib/types";

export async function POST(req: NextRequest) {
  const { caseId, rows, columnKeys } = await req.json();

  const caseData = getCase(caseId);
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

  bulkInsertRows(rowData);

  if (selectedColumns.length) {
    updateCase(caseId, { updatedAt: new Date().toISOString() });
  }

  return NextResponse.json({ imported: rowData.length });
}

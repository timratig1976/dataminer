import { NextRequest, NextResponse } from "next/server";
import { listRows, upsertRow, deleteRowsBulk } from "@/lib/db";
import { randomUUID } from "crypto";
import type { RowData } from "@/lib/types";

export async function GET(req: NextRequest) {
  const caseId = req.nextUrl.searchParams.get("caseId");
  if (!caseId) return NextResponse.json({ error: "caseId required" }, { status: 400 });
  return NextResponse.json(await listRows(caseId));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const row: RowData = {
    id: body.id || randomUUID(),
    caseId: body.caseId,
    rowIndex: body.rowIndex ?? 0,
    data: body.data || {},
    cellStatuses: {},
    cellErrors: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return NextResponse.json(await upsertRow(row), { status: 201 });
}

/** DELETE /api/rows — bulk delete rows + cascade contact_rows */
export async function DELETE(req: NextRequest) {
  const body = await req.json();
  const ids: string[] = body.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids (non-empty array) required" }, { status: 400 });
  }
  const result = await deleteRowsBulk(ids);
  return NextResponse.json({ ok: true, ...result });
}

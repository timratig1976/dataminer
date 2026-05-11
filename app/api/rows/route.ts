import { NextRequest, NextResponse } from "next/server";
import { listRows, upsertRow } from "@/lib/db";
import { randomUUID } from "crypto";
import type { RowData } from "@/lib/types";

export async function GET(req: NextRequest) {
  const caseId = req.nextUrl.searchParams.get("caseId");
  if (!caseId) return NextResponse.json({ error: "caseId required" }, { status: 400 });
  return NextResponse.json(listRows(caseId));
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
  return NextResponse.json(upsertRow(row), { status: 201 });
}

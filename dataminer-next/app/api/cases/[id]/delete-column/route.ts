import { NextRequest, NextResponse } from "next/server";
import { getCase, listRows, upsertRow } from "@/lib/db";

// Removes a plain (non-AI) column key from all rows of a case
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { key } = await req.json();

  if (!key || typeof key !== "string") {
    return NextResponse.json({ error: "key required" }, { status: 400 });
  }

  const caseData = getCase(id);
  if (!caseData) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  const rows = listRows(id);
  for (const row of rows) {
    if (key in row.data) {
      const newData = { ...row.data };
      delete newData[key];
      const newStatuses = { ...row.cellStatuses };
      delete newStatuses[key];
      const newErrors = { ...row.cellErrors };
      delete newErrors[key];
      upsertRow({ ...row, data: newData, cellStatuses: newStatuses, cellErrors: newErrors });
    }
  }

  return NextResponse.json({ ok: true, key, rowsUpdated: rows.length });
}

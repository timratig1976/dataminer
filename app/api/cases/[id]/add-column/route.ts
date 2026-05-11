import { NextRequest, NextResponse } from "next/server";
import { getCase, listRows, upsertRow } from "@/lib/db";

// Adds a plain (non-AI) column to all rows of a case with an empty value
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
    if (!(key in row.data)) {
      upsertRow({ ...row, data: { ...row.data, [key]: "" } });
    }
  }

  return NextResponse.json({ ok: true, key, rowsUpdated: rows.length });
}

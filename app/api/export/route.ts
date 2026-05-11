import { NextRequest, NextResponse } from "next/server";
import { getCase, listRows } from "@/lib/db";

export async function GET(req: NextRequest) {
  const caseId = req.nextUrl.searchParams.get("caseId");
  if (!caseId) return NextResponse.json({ error: "caseId required" }, { status: 400 });

  const caseData = getCase(caseId);
  if (!caseData) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rows = listRows(caseId);
  if (rows.length === 0) {
    return new NextResponse("", {
      headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="${caseData.name}.csv"` },
    });
  }

  // Build unified column set: source cols first, then AI output cols
  const aiOutputKeys = caseData.aiColumns.map((c) => c.outputKey);
  const allKeys = new Set<string>();
  for (const row of rows) Object.keys(row.data).forEach((k) => allKeys.add(k));
  const sourceKeys = [...allKeys].filter((k) => !aiOutputKeys.includes(k));
  const headers = [...sourceKeys, ...aiOutputKeys];

  const escape = (v: string | null) => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  const lines = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r.data[h] ?? null)).join(",")),
  ];
  const csv = lines.join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${caseData.name.replace(/[^a-z0-9]/gi, "_")}.csv"`,
    },
  });
}

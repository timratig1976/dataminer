import { NextRequest, NextResponse } from "next/server";
import { getCase, listRows, listContactRows } from "@/lib/db";

export async function GET(req: NextRequest) {
  const caseId = req.nextUrl.searchParams.get("caseId");
  if (!caseId) return NextResponse.json({ error: "caseId required" }, { status: 400 });

  const caseData = await getCase(caseId);
  if (!caseData) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [rows, contacts] = await Promise.all([
    listRows(caseId),
    listContactRows(caseId),
  ]);

  const snapshot = {
    _version: 2,
    exportedAt: new Date().toISOString(),
    case: {
      name: caseData.name,
      aiColumns: caseData.aiColumns,
      colOrder: caseData.colOrder ?? [],
    },
    rows: rows.map((r) => ({
      data: r.data,
      cellStatuses: r.cellStatuses,
      cellErrors: r.cellErrors,
    })),
    contacts: contacts.map((c) => ({
      data: c.data,
      cellStatuses: c.cellStatuses,
      cellErrors: c.cellErrors,
    })),
  };

  const filename = `${caseData.name.replace(/[^a-z0-9]/gi, "_")}_snapshot.json`;
  return new NextResponse(JSON.stringify(snapshot, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

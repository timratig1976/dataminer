import { NextRequest, NextResponse } from "next/server";
import { getLogs, clearLogs, clearAllLogs } from "@/lib/db";

export async function GET(req: NextRequest) {
  const caseId = req.nextUrl.searchParams.get("caseId");
  if (!caseId) return NextResponse.json({ error: "caseId required" }, { status: 400 });
  const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "200", 10);
  return NextResponse.json(await getLogs(caseId, limit));
}

export async function DELETE(req: NextRequest) {
  const caseId = req.nextUrl.searchParams.get("caseId");
  if (caseId) {
    await clearLogs(caseId);
  } else {
    // No caseId → delete all logs across all cases
    await clearAllLogs();
  }
  return NextResponse.json({ ok: true });
}

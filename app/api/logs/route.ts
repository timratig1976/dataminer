import { NextRequest, NextResponse } from "next/server";
import { getLogs, clearLogs } from "@/lib/db";

export async function GET(req: NextRequest) {
  const caseId = req.nextUrl.searchParams.get("caseId");
  if (!caseId) return NextResponse.json({ error: "caseId required" }, { status: 400 });
  const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "200", 10);
  return NextResponse.json(getLogs(caseId, limit));
}

export async function DELETE(req: NextRequest) {
  const caseId = req.nextUrl.searchParams.get("caseId");
  if (!caseId) return NextResponse.json({ error: "caseId required" }, { status: 400 });
  clearLogs(caseId);
  return NextResponse.json({ ok: true });
}

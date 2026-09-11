import { NextRequest, NextResponse } from "next/server";
import { listRowsGrouped } from "@/lib/db";

export async function GET(req: NextRequest) {
  const caseId = req.nextUrl.searchParams.get("caseId");
  if (!caseId) return NextResponse.json({ error: "caseId required" }, { status: 400 });

  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") ?? "1", 10));
  const perPage = Math.min(200, Math.max(10, parseInt(req.nextUrl.searchParams.get("perPage") ?? "50", 10)));

  try {
    const data = await listRowsGrouped(caseId, page, perPage);
    return NextResponse.json(data);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
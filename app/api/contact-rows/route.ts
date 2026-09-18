import { NextRequest, NextResponse } from "next/server";
import { listContactRows, upsertContactRows, deleteContactRowsByCase } from "@/lib/db";

/** GET /api/contact-rows?caseId=xxx */
export async function GET(req: NextRequest) {
  const caseId = req.nextUrl.searchParams.get("caseId");
  if (!caseId) return NextResponse.json({ error: "caseId required" }, { status: 400 });
  const contacts = await listContactRows(caseId);
  return NextResponse.json({ contacts, total: contacts.length });
}

/** DELETE /api/contact-rows?caseId=xxx — clear all contacts for a case */
export async function DELETE(req: NextRequest) {
  const caseId = req.nextUrl.searchParams.get("caseId");
  if (!caseId) return NextResponse.json({ error: "caseId required" }, { status: 400 });
  await deleteContactRowsByCase(caseId);
  return NextResponse.json({ ok: true });
}

/** PATCH /api/contact-rows — upsert contacts for a company row */
export async function PATCH(req: NextRequest) {
  const { caseId, companyRowId, contacts } = await req.json();
  if (!caseId || !companyRowId || !Array.isArray(contacts)) {
    return NextResponse.json({ error: "caseId, companyRowId, contacts required" }, { status: 400 });
  }
  const result = await upsertContactRows(caseId, companyRowId, contacts);
  return NextResponse.json({ ok: true, ...result });
}

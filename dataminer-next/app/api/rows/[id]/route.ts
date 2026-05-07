import { NextRequest, NextResponse } from "next/server";
import { getRow, upsertRow, deleteRow } from "@/lib/db";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = getRow(id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json();
  const updated = upsertRow({ ...existing, ...body, id });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  deleteRow(id);
  return NextResponse.json({ ok: true });
}

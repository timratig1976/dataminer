import { NextRequest, NextResponse } from "next/server";
import { getCase, updateCase, deleteCase } from "@/lib/db";
import type { Case } from "@/lib/types";

function sanitizeCase(c: Case) {
  return {
    ...c,
    apiKey: undefined,
    cerebrasApiKey: undefined,
    anthropicApiKey: undefined,
  };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = getCase(id);
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(sanitizeCase(c));
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const c = updateCase(id, body);
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(sanitizeCase(c));
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  deleteCase(id);
  return NextResponse.json({ ok: true });
}

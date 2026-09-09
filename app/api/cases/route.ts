import { NextRequest, NextResponse } from "next/server";
import { listCases, createCase } from "@/lib/db";
import { randomUUID } from "crypto";
import type { Case } from "@/lib/types";

function sanitizeCase(c: Case) {
  return {
    ...c,
    edenApiKey: undefined,
  };
}

export async function GET() {
  try {
    const cases = await listCases();
    return NextResponse.json(cases.map(sanitizeCase));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const c = await createCase({
      id: randomUUID(),
      name: body.name || "New Case",
      aiColumns: body.aiColumns || [],
      edenApiKey: body.edenApiKey,
    });
    return NextResponse.json(sanitizeCase(c), { status: 201 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

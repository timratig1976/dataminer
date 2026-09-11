import { NextRequest, NextResponse } from "next/server";
import { listCases, createCase } from "@/lib/db";
import { randomUUID } from "crypto";
import { getTemplate } from "@/lib/templates";
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

    // Resolve template if specified
    let aiColumns = body.aiColumns || [];
    if (body.template && !body.aiColumns) {
      const tpl = getTemplate(body.template);
      if (tpl) {
        aiColumns = tpl.aiColumns;
      }
    }

    const c = await createCase({
      id: randomUUID(),
      name: body.name || "New Case",
      aiColumns,
      edenApiKey: body.edenApiKey,
    });
    return NextResponse.json(sanitizeCase(c), { status: 201 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

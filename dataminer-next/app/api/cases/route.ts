import { NextRequest, NextResponse } from "next/server";
import { listCases, createCase } from "@/lib/db";
import { randomUUID } from "crypto";

export async function GET() {
  try {
    const cases = listCases();
    return NextResponse.json(cases);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const c = createCase({
      id: randomUUID(),
      name: body.name || "New Case",
      aiColumns: body.aiColumns || [],
      apiKey: body.apiKey,
    });
    return NextResponse.json(c, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

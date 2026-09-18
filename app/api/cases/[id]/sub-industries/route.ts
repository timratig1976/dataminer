import { NextRequest, NextResponse } from "next/server";
import { getCase, resolveEdenKey } from "@/lib/db";
import { analyseSubIndustries } from "@/lib/planner";

export const runtime = "nodejs";

/**
 * POST /api/cases/[id]/sub-industries
 * Analyse a research prompt and return sub-industry suggestions.
 * Body: { prompt: string, model?: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;
  const caseData = await getCase(caseId);
  if (!caseData) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  const { prompt, model } = await req.json();
  if (!prompt?.trim()) return NextResponse.json({ error: "prompt required" }, { status: 400 });

  const edenApiKey = await resolveEdenKey(caseData);
  if (!edenApiKey) return NextResponse.json({ error: "No Eden API key configured" }, { status: 400 });

  try {
    const analysis = await analyseSubIndustries(
      prompt.trim(),
      edenApiKey,
      model ?? "openai/gpt-4o-mini"
    );
    return NextResponse.json(analysis);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

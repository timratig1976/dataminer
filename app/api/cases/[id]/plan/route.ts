import { NextRequest, NextResponse } from "next/server";
import { getCase, resolveEdenKey, getGlobalSettings } from "@/lib/db";
import { createDiscoveryPlan } from "@/lib/planner";

export const runtime = "nodejs";

/**
 * POST /api/cases/[id]/plan
 * Generate a DiscoveryPlan from a natural-language prompt.
 * No DB writes — just planning.
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

  const globalSettings = await getGlobalSettings();

  try {
    const plan = await createDiscoveryPlan(prompt, {
      edenApiKey,
      model: model ?? "openai/gpt-4o-mini",
      serpApiKeyAvailable: !!process.env.SERP_API_KEY,
      braveApiKeyAvailable: !!process.env.BRAVE_API_KEY,
      edenKeyAvailable: true,
      systemPromptOverride: globalSettings.plannerPrompt ?? null,
    });
    return NextResponse.json(plan);
  } catch (e: unknown) {
    const msg = (e as Error).message ?? "Plan creation failed";
    console.error("[plan] Error:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

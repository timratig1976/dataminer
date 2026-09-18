import { NextRequest, NextResponse } from "next/server";
import { getCase, resolveEdenKey, listAgentRuns, resolveSearchKeys, getGlobalSettings } from "@/lib/db";
import { startAgentRun } from "@/lib/agent-runner";

export const runtime = "nodejs";

/**
 * POST /api/cases/[id]/agent/start
 * Creates a new AgentRun and returns the initial state.
 *
 * Body: { goal: AgentGoal, model?: string }
 * Goal shape: { description: string, targetCount: number, region?: string, maxBudgetUsd?, maxDurationMin?, maxIterations? }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;

  const caseData = await getCase(caseId);
  if (!caseData) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  const { goal, model } = await req.json();
  if (!goal?.description?.trim()) return NextResponse.json({ error: "goal.description required" }, { status: 400 });
  if (!goal?.targetCount || goal.targetCount < 1) return NextResponse.json({ error: "goal.targetCount >= 1 required" }, { status: 400 });

  const edenApiKey = await resolveEdenKey(caseData);
  if (!edenApiKey) return NextResponse.json({ error: "No Eden API key configured" }, { status: 400 });

  const searchKeys = await resolveSearchKeys();
  const globalSettings = await getGlobalSettings();

  try {
    const run = await startAgentRun(caseId, {
      description: String(goal.description).trim(),
      targetCount: Number(goal.targetCount),
      region: goal.region ?? undefined,
      maxBudgetUsd: goal.maxBudgetUsd ?? undefined,
      maxDurationMin: goal.maxDurationMin ?? undefined,
      maxIterations: goal.maxIterations ?? undefined,
      useMaps: goal.useMaps ?? true,
    }, {
      edenApiKey,
      model,
      serpApiKey: searchKeys.serpApiKey || process.env.SERP_API_KEY?.trim() || undefined,
      serperApiKey: searchKeys.serperApiKey || process.env.SERPER_API_KEY?.trim() || undefined,
      braveApiKey: searchKeys.braveApiKey || process.env.BRAVE_API_KEY?.trim() || undefined,
      systemPromptOverride: globalSettings.plannerPrompt ?? null,
    });
    return NextResponse.json(run);
  } catch (e: unknown) {
    console.error("[agent/start]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/**
 * GET /api/cases/[id]/agent
 * Lists all agent runs for this case (history + any in-progress run).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;
  const caseData = await getCase(caseId);
  if (!caseData) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  const runs = await listAgentRuns(caseId);
  return NextResponse.json(runs);
}
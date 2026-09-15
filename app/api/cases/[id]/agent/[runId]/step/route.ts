import { NextRequest, NextResponse } from "next/server";
import { getCase, resolveEdenKey, getAgentRun, resolveSearchKeys } from "@/lib/db";
import { executeNextStep } from "@/lib/agent-runner";
import { registerOperation } from "@/lib/operations";

export const runtime = "nodejs";

/**
 * POST /api/cases/[id]/agent/[runId]/step
 * Executes ONE pending PlanStep and returns the updated AgentRunState.
 * The client (useAgentRun hook) calls this in a loop until status is terminal.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  const { id: caseId, runId } = await params;

  const caseData = await getCase(caseId);
  if (!caseData) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  const run = await getAgentRun(runId);
  if (!run || run.caseId !== caseId) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const edenApiKey = await resolveEdenKey(caseData);
  if (!edenApiKey) return NextResponse.json({ error: "No Eden API key configured" }, { status: 400 });

  const searchKeys = await resolveSearchKeys();
  const cancelKey = runId;
  registerOperation({ type: "cell", caseId, startTime: Date.now() });

  try {
    const updated = await executeNextStep(runId, {
      edenApiKey,
      serpApiKey: searchKeys.serpApiKey,
      serperApiKey: searchKeys.serperApiKey,
      braveApiKey: searchKeys.braveApiKey,
      apifyApiToken: searchKeys.apifyApiToken,
      scraplingUrl: process.env.SCRAPLING_URL?.trim() || undefined,
      scraplingToken: process.env.SCRAPLING_TOKEN?.trim() || undefined,
    }, cancelKey);
    return NextResponse.json(updated);
  } catch (e: unknown) {
    console.error("[agent/step]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

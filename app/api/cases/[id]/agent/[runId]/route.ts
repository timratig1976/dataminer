import { NextRequest, NextResponse } from "next/server";
import { getCase, resolveEdenKey, getAgentRun } from "@/lib/db";
import { executeNextStep, cancelAgentRun, resumeAgentRun } from "@/lib/agent-runner";
import { registerOperation } from "@/lib/operations";

export const runtime = "nodejs";

// ── Shared: verify run belongs to case ─────────────────────────────────────
async function assertRunBelongsToCase(caseId: string, runId: string): Promise<boolean> {
  const run = await getAgentRun(runId);
  return run?.caseId === caseId;
}

/**
 * POST /api/cases/[id]/agent/[runId]/step
 * Executes ONE pending PlanStep and returns the updated AgentRunState.
 * Client calls this in a loop until status is terminal.
 */
async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  const { id: caseId, runId } = await params;

  const caseData = await getCase(caseId);
  if (!caseData) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  // Verify run ownership — prevent leaking state of other cases' runs
  if (!(await assertRunBelongsToCase(caseId, runId))) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const edenApiKey = await resolveEdenKey(caseData);
  if (!edenApiKey) return NextResponse.json({ error: "No Eden API key configured" }, { status: 400 });

  // Use runId as the stable cancel key so cancel() from any request is effective
  const cancelKey = runId;
  registerOperation({ type: "cell", caseId, startTime: Date.now() });

  try {
    const run = await executeNextStep(runId, {
      edenApiKey,
      serpApiKey: process.env.SERP_API_KEY?.trim() || undefined,
      braveApiKey: process.env.BRAVE_API_KEY?.trim() || undefined,
      scraplingUrl: process.env.SCRAPLING_URL?.trim() || undefined,
      scraplingToken: process.env.SCRAPLING_TOKEN?.trim() || undefined,
    }, cancelKey);
    return NextResponse.json(run);
  } catch (e: unknown) {
    console.error("[agent/step]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/**
 * POST /api/cases/[id]/agent/[runId]/cancel
 * Marks the run as cancelled.
 */
async function CANCEL(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  const { id: caseId, runId } = await params;

  if (!(await assertRunBelongsToCase(caseId, runId))) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  try {
    const run = await cancelAgentRun(runId);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    return NextResponse.json(run);
  } catch (e: unknown) {
    console.error("[agent/cancel]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/**
 * GET /api/cases/[id]/agent/[runId]
 * Returns the current AgentRunState (for polling progress after reload).
 */
async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  const { id: caseId, runId } = await params;
  if (!(await assertRunBelongsToCase(caseId, runId))) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  const run = await getAgentRun(runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  return NextResponse.json(run);
}

/**
 * PATCH /api/cases/[id]/agent/[runId]
 * Resume a completed/error/cancelled run. Optionally merge new steps.
 * Body: { extraSteps?: PlanStep[], targetCount?: number }
 */
async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  const { id: caseId, runId } = await params;
  if (!(await assertRunBelongsToCase(caseId, runId))) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const run = await resumeAgentRun(runId, {
      extraSteps: body.extraSteps ?? undefined,
      targetCount: body.targetCount ?? undefined,
    });
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    return NextResponse.json(run);
  } catch (e: unknown) {
    console.error("[agent/resume]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export { POST, CANCEL as PUT, PATCH, GET };
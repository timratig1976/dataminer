import { NextRequest, NextResponse } from "next/server";
import { getCase, resolveEdenKey, getAgentRun, resolveSearchKeys, getGlobalSettings } from "@/lib/db";
import { resumeAgentRun } from "@/lib/agent-runner";
import { createDiscoveryPlan } from "@/lib/planner";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

/**
 * POST /api/cases/[id]/agent/[runId]/extend
 * Takes a natural-language context string, uses the LLM planner to generate
 * new PlanSteps, appends them to the existing run, and resumes it.
 *
 * Body: { context: string }
 * Returns: updated AgentRunState
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  const { id: caseId, runId } = await params;

  const caseData = await getCase(caseId);
  if (!caseData) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  const run = await getAgentRun(runId);
  if (!run || run.caseId !== caseId) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const context: string = (body.context ?? "").trim();
  if (!context) {
    return NextResponse.json({ error: "context is required" }, { status: 400 });
  }

  const edenApiKey = await resolveEdenKey(caseData);
  if (!edenApiKey) {
    return NextResponse.json({ error: "No Eden API key configured" }, { status: 400 });
  }

  const searchKeys = await resolveSearchKeys();
  const globalSettings = await getGlobalSettings().catch(() => null);

  // Build an extension prompt that gives the planner context about what already ran
  const existingStepLabels = run.plan.steps
    .map(s => s.label || s.mapQuery || s.query || "")
    .filter(Boolean)
    .slice(-10) // last 10 steps for context
    .join(", ");

  const extensionPrompt = `Erweiterung einer bestehenden Suche.

Ursprüngliches Ziel: ${run.goal.description}
Bereits ausgeführte Steps (letzte 10): ${existingStepLabels || "keine"}
Bereits gefunden: ${run.uniqueCount} von ${run.goal.targetCount} Einträgen

Neue Suchanfrage des Nutzers:
${context}

Plane NUR neue Steps die noch nicht abgedeckt sind. Vermeide Duplikate zu den bestehenden Steps.`;

  try {
    const plan = await createDiscoveryPlan(extensionPrompt, {
      edenApiKey,
      model: globalSettings?.plannerModel || "openai/gpt-4o-mini",
      serpApiKeyAvailable: !!(searchKeys.serpApiKey),
      serperApiKeyAvailable: !!(searchKeys.serperApiKey),
      braveApiKeyAvailable: !!(searchKeys.braveApiKey),
      useMaps: run.goal.useMaps ?? true,
      maxResults: run.goal.targetCount - run.uniqueCount,
      systemPromptOverride: globalSettings?.plannerPrompt || null,
    });

    // Stamp unique IDs
    const extraSteps = plan.steps.map(s => ({
      ...s,
      id: `ext_${randomUUID().slice(0, 8)}`,
    }));

    if (extraSteps.length === 0) {
      return NextResponse.json({ error: "LLM hat keine neuen Steps generiert" }, { status: 422 });
    }

    const updated = await resumeAgentRun(runId, { extraSteps });
    if (!updated) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    return NextResponse.json({ run: updated, newSteps: extraSteps.length });
  } catch (e: unknown) {
    console.error("[agent/extend]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

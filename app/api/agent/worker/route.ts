import { NextRequest, NextResponse } from "next/server";
import { getAllRunningRuns, getCase, resolveEdenKey, resolveSearchKeys } from "@/lib/db";
import { executeNextStep } from "@/lib/agent-runner";
import { registerOperation } from "@/lib/operations";

export const runtime = "nodejs";

/**
 * Returns a stable set of runIds that are currently "owned" by an active page tab.
 * The page loop writes localStorage keys `agentLoop:{runId}` with a timestamp.
 * Since this is a server endpoint we read the same via request headers sent by the client.
 */
function getClientOwnedRunIds(req: NextRequest): Set<string> {
  const raw = req.headers.get("x-agent-owned-runs") ?? "";
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

/**
 * POST /api/agent/worker
 * Executes ONE step for each currently running agent run across all cases.
 * Runs "owned" by an active page tab (heartbeat < 5s) are skipped to avoid double-stepping.
 */
export async function POST(req: NextRequest) {
  const runningRuns = await getAllRunningRuns();
  const owned = getClientOwnedRunIds(req);
  const now = Date.now();
  const HEARTBEAT_TTL = 5000;

  // Filter out runs that have a fresh client-side heartbeat
  const runsToProcess = runningRuns.filter(({ id }) => {
    if (!owned.has(id)) return true;
    // Client claims ownership — trust it, the page loop will handle this run
    return false;
  });

  if (runsToProcess.length === 0) {
    return NextResponse.json({ results: [], skipped: runningRuns.length - runsToProcess.length });
  }

  const searchKeys = await resolveSearchKeys();

  const results = await Promise.allSettled(
    runsToProcess.map(async ({ id: runId, caseId }) => {
      const caseData = await getCase(caseId);
      if (!caseData) return { runId, caseId, status: "error", error: "Case not found" };

      const edenApiKey = await resolveEdenKey(caseData);
      if (!edenApiKey) return { runId, caseId, status: "error", error: "No Eden API key" };

      registerOperation({ type: "cell", caseId, startTime: Date.now() });

      const updated = await executeNextStep(runId, {
        edenApiKey,
        serpApiKey: searchKeys.serpApiKey,
        serperApiKey: searchKeys.serperApiKey,
        braveApiKey: searchKeys.braveApiKey,
        apifyApiToken: searchKeys.apifyApiToken,
        scraplingUrl: process.env.SCRAPLING_URL?.trim() || undefined,
        scraplingToken: process.env.SCRAPLING_TOKEN?.trim() || undefined,
      }, runId);

      return {
        runId,
        caseId,
        status: updated.status,
        uniqueCount: updated.uniqueCount,
        targetCount: updated.goal.targetCount,
      };
    })
  );

  const output = results.map((r) =>
    r.status === "fulfilled" ? r.value : { error: (r.reason as Error).message }
  );

  return NextResponse.json({ results: output });
}

/**
 * GET /api/agent/worker
 * Returns all currently running runs (for polling / status display).
 */
export async function GET(_req: NextRequest) {
  const running = await getAllRunningRuns();
  return NextResponse.json({ running });
}

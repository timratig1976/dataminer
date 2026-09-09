import { NextRequest, NextResponse } from "next/server";
import { appendLog, getCase, resolveEdenKey, resolveEdenRegion } from "@/lib/db";
import { DEFAULT_MODEL_OPTIONS } from "@/lib/model-options";
import { edenChatCompletion, type EdenRegion } from "@/lib/edenai";

interface SmokeResult {
  model: string;
  provider: "edenai";
  endpoint: string;
  ok: boolean;
  latencyMs: number;
  preview?: string;
  error?: string;
}

function normalizeModels(input: unknown): string[] {
  if (!Array.isArray(input)) return [...DEFAULT_MODEL_OPTIONS];
  const models = input
    .filter((m): m is string => typeof m === "string")
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
  return models.length > 0 ? models : [...DEFAULT_MODEL_OPTIONS];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const ENDPOINT = "/v3/chat/completions";

async function smokeOneModel(model: string, apiKey: string | undefined, edenRegion: EdenRegion): Promise<SmokeResult> {
  if (!apiKey) {
    return {
      model,
      provider: "edenai",
      endpoint: ENDPOINT,
      ok: false,
      latencyMs: 0,
      error: "Missing EDEN_API_KEY (case-level or env)",
    };
  }

  const started = Date.now();
  try {
    const result = await edenChatCompletion({
      apiKey,
      region: edenRegion,
      model,
      system: "You are a smoke test responder.",
      prompt: "Reply with exactly: ok",
      maxTokens: 12,
    });
    return {
      model,
      provider: "edenai",
      endpoint: ENDPOINT,
      ok: true,
      latencyMs: Date.now() - started,
      preview: result.raw.slice(0, 120),
    };
  } catch (error: unknown) {
    return {
      model,
      provider: "edenai",
      endpoint: ENDPOINT,
      ok: false,
      latencyMs: Date.now() - started,
      error: errorMessage(error),
    };
  }
}

async function runSmokeTest(payload: { caseId?: unknown; models?: unknown }) {
  const caseId = typeof payload.caseId === "string" ? payload.caseId : undefined;
  const models = normalizeModels(payload.models);

  let edenKey = await resolveEdenKey();
  let edenRegion: EdenRegion = await resolveEdenRegion();

  if (caseId) {
    const caseData = await getCase(caseId);
    if (!caseData) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }
    edenKey = await resolveEdenKey(caseData);
    edenRegion = await resolveEdenRegion(caseData);
    void appendLog(caseId, `🧪 [SMOKE] Start models=${models.join(", ")}`);
  }

  const results: SmokeResult[] = [];
  for (const model of models) {
    const r = await smokeOneModel(model, edenKey, edenRegion);
    results.push(r);
    if (caseId) {
      void appendLog(caseId, `▶ [SMOKE] model=${model} provider=edenai endpoint=${ENDPOINT}`);
      void appendLog(
        caseId,
        `${r.ok ? "✅" : "❌"} [SMOKE] ${model} → ${r.ok ? r.preview : r.error} (${r.latencyMs}ms)`
      );
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  if (caseId) void appendLog(caseId, `🏁 [SMOKE] Finished tested=${results.length} passed=${passed} failed=${failed}`);

  return NextResponse.json({
    caseId: caseId ?? null,
    testedModels: models.length,
    passed,
    failed,
    keysPresent: { edenai: Boolean(edenKey) },
    edenRegion,
    results,
  });
}

export async function GET() {
  return runSmokeTest({});
}

export async function POST(req: NextRequest) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  return runSmokeTest((payload ?? {}) as { caseId?: unknown; models?: unknown });
}

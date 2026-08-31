import { NextRequest, NextResponse } from "next/server";
import { getCase, getEffectiveApiKey } from "@/lib/db";
import { listEdenModels, edenChatCompletion, edenWebSearch, type EdenRegion } from "@/lib/edenai";

interface TestBody {
  caseId?: string;
  apiKey?: string;
  region?: string;
  model?: string;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Preferred cheap models for the chat check, in order; first one present in the
// region's catalog wins. Falls back to the first catalog entry.
const AUTO_PICK = [
  "mistral/mistral-small-latest",
  "openai/gpt-4o-mini",
  "google/gemini-flash-latest",
];

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as TestBody;
  const region: EdenRegion = body.region === "us" ? "us" : "eu";

  // Use the key typed in the settings form if present, else the stored key
  let apiKey = body.apiKey?.trim() || undefined;
  if (!apiKey && body.caseId) {
    const c = getCase(body.caseId);
    if (c) apiKey = getEffectiveApiKey(c, "edenai");
  }
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, region, checks: {}, error: "No Eden AI API key provided or stored." },
      { status: 400 }
    );
  }

  const checks: Record<string, Record<string, unknown>> = {};

  // ── 1) Model catalog (validates region + connectivity) ──
  let models: string[] = [];
  try {
    const list = await listEdenModels(region, apiKey);
    models = list.map((m) => m.id);
    checks.catalog = { ok: true, count: models.length };
  } catch (e) {
    checks.catalog = { ok: false, error: msg(e) };
  }

  // ── 2) Chat completion (validates the key for LLM calls) ──
  const wanted = body.model?.trim();
  const model =
    (wanted && models.includes(wanted) ? wanted : undefined) ??
    AUTO_PICK.find((m) => models.includes(m)) ??
    models[0];

  if (!model) {
    checks.chat = { ok: false, error: "No model available in this region" };
  } else {
    const t0 = Date.now();
    try {
      const r = await edenChatCompletion({
        apiKey,
        region,
        model,
        system: "You are a smoke test responder.",
        prompt: "Reply with exactly: ok",
        maxTokens: 12,
      });
      checks.chat = {
        ok: true,
        model,
        latencyMs: Date.now() - t0,
        preview: r.raw.slice(0, 80),
        costUsd: r.costUsd,
      };
    } catch (e) {
      checks.chat = { ok: false, model, error: msg(e) };
    }
  }

  // ── 3) Firecrawl web search (US endpoint only) ──
  {
    const t0 = Date.now();
    try {
      const r = await edenWebSearch({ apiKey, query: "test", limit: 2 });
      checks.firecrawl = {
        ok: r.results.length > 0,
        resultCount: r.results.length,
        latencyMs: Date.now() - t0,
        preview: r.results[0]?.title,
      };
    } catch (e) {
      checks.firecrawl = { ok: false, error: msg(e) };
    }
  }

  const ok = !!checks.catalog?.ok && !!checks.chat?.ok;
  return NextResponse.json({ ok, region, checks });
}

import { NextRequest, NextResponse } from "next/server";
import { getGlobalSettings, resolveEdenKey, resolveSearchKeys } from "@/lib/db";
import { createDiscoveryPlan, buildDefaultSystemPrompt } from "@/lib/planner";

export const runtime = "nodejs";

/**
 * POST /api/settings/test-planner
 * Test the planner with a prompt + optional system prompt override.
 * Returns the full DiscoveryPlan for preview.
 *
 * Body: { prompt: string, systemPrompt?: string | null, maxResults?: number }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const prompt: string = (body.prompt ?? "").trim();
    if (!prompt) return NextResponse.json({ error: "prompt required" }, { status: 400 });

    const globalSettings = await getGlobalSettings();
    const edenApiKey = globalSettings.edenApiKey || process.env.EDEN_API_KEY?.trim();
    if (!edenApiKey) return NextResponse.json({ error: "No Eden API key configured" }, { status: 400 });

    const searchKeys = await resolveSearchKeys();

    // Use the provided override, or fall back to the DB-stored override
    const systemPromptOverride: string | null =
      "systemPrompt" in body
        ? (body.systemPrompt === null || body.systemPrompt === "" ? null : String(body.systemPrompt))
        : (globalSettings.plannerSystemPrompt ?? null);

    const t0 = Date.now();
    const plan = await createDiscoveryPlan(prompt, {
      edenApiKey,
      model: body.model ?? "openai/gpt-4o-mini",
      serpApiKeyAvailable: !!(searchKeys.serpApiKey || process.env.SERP_API_KEY),
      serperApiKeyAvailable: !!(searchKeys.serperApiKey || process.env.SERPER_API_KEY),
      braveApiKeyAvailable: !!(searchKeys.braveApiKey || process.env.BRAVE_API_KEY),
      edenKeyAvailable: true,
      maxResults: body.maxResults ?? undefined,
      systemPromptOverride,
    });
    const latencyMs = Date.now() - t0;

    return NextResponse.json({ plan, latencyMs, usedOverride: systemPromptOverride !== null });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/**
 * GET /api/settings/test-planner
 * Returns the built-in default system prompt so the UI can show it as placeholder.
 */
export async function GET() {
  try {
    const globalSettings = await getGlobalSettings();
    const searchKeys = await resolveSearchKeys();
    const defaultPrompt = buildDefaultSystemPrompt({
      serpapi: !!(searchKeys.serpApiKey || process.env.SERP_API_KEY),
      serper: !!(searchKeys.serperApiKey || process.env.SERPER_API_KEY),
      google_maps: true,
      brave: !!(searchKeys.braveApiKey || process.env.BRAVE_API_KEY),
      firecrawl_via_eden: !!globalSettings.edenApiKey,
    });
    return NextResponse.json({
      defaultPrompt,
      currentOverride: globalSettings.plannerSystemPrompt ?? null,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getGlobalSettings, saveGlobalSettings, type GlobalSettings } from "@/lib/db";

/**
 * Helper to build standard settings response containing all masked keys and status.
 */
function settingsResponse(s: GlobalSettings) {
  return {
    edenApiKeyMasked: s.edenApiKeyMasked,
    edenRegion: s.edenRegion,
    modelAllowlist: s.modelAllowlist,
    hasKey: Boolean(s.edenApiKey),
    envKeyPresent: Boolean(process.env.EDEN_API_KEY?.trim()),
    serperApiKeyMasked: s.serperApiKeyMasked,
    serpApiKeyMasked: s.serpApiKeyMasked,
    braveApiKeyMasked: s.braveApiKeyMasked,
    apifyApiTokenMasked: s.apifyApiTokenMasked,
    firecrawlApiKeyMasked: s.firecrawlApiKeyMasked,
    hasFirecrawlKey: Boolean(s.firecrawlApiKey),
    firecrawlEnvPresent: Boolean(process.env.FIRECRAWL_API_KEY?.trim()),
    serperEnvPresent: Boolean(process.env.SERPER_API_KEY?.trim()),
    serpEnvPresent: Boolean(process.env.SERP_API_KEY?.trim()),
    braveEnvPresent: Boolean(process.env.BRAVE_API_KEY?.trim()),
    apifyEnvPresent: Boolean(process.env.APIFY_API_TOKEN?.trim()),
    plannerPrompt: s.plannerPrompt ?? null,
    updatedAt: s.updatedAt,
  };
}

/**
 * Global app settings.
 *
 * GET  /api/settings        → full settings object
 * PATCH /api/settings       → body { edenApiKey?, edenRegion?, firecrawlApiKey?, serperApiKey?, serpApiKey?, braveApiKey?, apifyApiToken? }
 *   - string                → store (encrypted); empty string "" clears the key
 *   - omitted (undefined)   → keep the stored key unchanged
 * DELETE /api/settings?key=eden|firecrawl|serper|serp|brave|apify → clears the specified key
 */
export async function GET() {
  try {
    const s = await getGlobalSettings();
    return NextResponse.json(settingsResponse(s));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      edenApiKey?: string;
      edenRegion?: string;
      modelAllowlist?: string[];
      firecrawlApiKey?: string;
      serperApiKey?: string;
      serpApiKey?: string;
      braveApiKey?: string;
      apifyApiToken?: string;
      plannerSystemPrompt?: string | null;
    };
    const patch: {
      edenApiKey?: string;
      edenRegion?: "eu" | "us";
      modelAllowlist?: string[];
      firecrawlApiKey?: string;
      serperApiKey?: string;
      serpApiKey?: string;
      braveApiKey?: string;
      apifyApiToken?: string;
      plannerSystemPrompt?: string | null;
    } = {};

    if (typeof body.edenApiKey === "string") patch.edenApiKey = body.edenApiKey.trim();
    if (body.edenRegion === "eu" || body.edenRegion === "us") patch.edenRegion = body.edenRegion;
    if (Array.isArray(body.modelAllowlist)) patch.modelAllowlist = body.modelAllowlist.filter((m): m is string => typeof m === "string" && m.trim().length > 0);
    if (typeof body.firecrawlApiKey === "string") patch.firecrawlApiKey = body.firecrawlApiKey.trim();
    if (typeof body.serperApiKey === "string") patch.serperApiKey = body.serperApiKey.trim();
    if (typeof body.serpApiKey === "string") patch.serpApiKey = body.serpApiKey.trim();
    if (typeof body.braveApiKey === "string") patch.braveApiKey = body.braveApiKey.trim();
    if (typeof body.apifyApiToken === "string") patch.apifyApiToken = body.apifyApiToken.trim();
    if ("plannerSystemPrompt" in body) patch.plannerSystemPrompt = body.plannerSystemPrompt === null ? null : (body.plannerSystemPrompt ?? "").trim() || null;

    const s = await saveGlobalSettings(patch);
    return NextResponse.json(settingsResponse(s));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const targetKey = searchParams.get("key") || "eden";

    const patch: Parameters<typeof saveGlobalSettings>[0] = {};
    if (targetKey === "eden") patch.edenApiKey = "";
    else if (targetKey === "firecrawl") patch.firecrawlApiKey = "";
    else if (targetKey === "serper") patch.serperApiKey = "";
    else if (targetKey === "serp") patch.serpApiKey = "";
    else if (targetKey === "brave") patch.braveApiKey = "";
    else if (targetKey === "apify") patch.apifyApiToken = "";

    const s = await saveGlobalSettings(patch);
    return NextResponse.json({ ok: true, ...settingsResponse(s) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

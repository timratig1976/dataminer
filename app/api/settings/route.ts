import { NextRequest, NextResponse } from "next/server";
import { getGlobalSettings, saveGlobalSettings } from "@/lib/db";

/**
 * Global app settings — Eden AI is the only LLM provider.
 *
 * GET  /api/settings        → { edenApiKeyMasked, edenRegion, hasKey, updatedAt }
 * PATCH /api/settings       → body { edenApiKey?, edenRegion? }
 *   - edenApiKey: string    → store (encrypted); empty string clears the key
 *   - edenApiKey omitted    → keep the stored key unchanged
 * DELETE /api/settings      → clears the stored key
 */
export async function GET() {
  try {
    const s = await getGlobalSettings();
    return NextResponse.json({
      edenApiKeyMasked: s.edenApiKeyMasked,
      edenRegion: s.edenRegion,
      modelAllowlist: s.modelAllowlist,
      hasKey: Boolean(s.edenApiKey),
      envKeyPresent: Boolean(process.env.EDEN_API_KEY?.trim()),
      serperApiKeyMasked: s.serperApiKeyMasked,
      serpApiKeyMasked: s.serpApiKeyMasked,
      braveApiKeyMasked: s.braveApiKeyMasked,
      apifyApiTokenMasked: s.apifyApiTokenMasked,
      serperEnvPresent: Boolean(process.env.SERPER_API_KEY?.trim()),
      serpEnvPresent: Boolean(process.env.SERP_API_KEY?.trim()),
      braveEnvPresent: Boolean(process.env.BRAVE_API_KEY?.trim()),
      apifyEnvPresent: Boolean(process.env.APIFY_API_TOKEN?.trim()),
      updatedAt: s.updatedAt,
    });
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
      serperApiKey?: string;
      serpApiKey?: string;
      braveApiKey?: string;
      apifyApiToken?: string;
    };
    const patch: { edenApiKey?: string; edenRegion?: "eu" | "us"; modelAllowlist?: string[]; serperApiKey?: string; serpApiKey?: string; braveApiKey?: string; apifyApiToken?: string } = {};
    if (typeof body.edenApiKey === "string") patch.edenApiKey = body.edenApiKey.trim();
    if (body.edenRegion === "eu" || body.edenRegion === "us") patch.edenRegion = body.edenRegion;
    if (Array.isArray(body.modelAllowlist)) patch.modelAllowlist = body.modelAllowlist.filter((m): m is string => typeof m === "string" && m.trim().length > 0);
    if (typeof body.serperApiKey === "string") patch.serperApiKey = body.serperApiKey.trim();
    if (typeof body.serpApiKey === "string") patch.serpApiKey = body.serpApiKey.trim();
    if (typeof body.braveApiKey === "string") patch.braveApiKey = body.braveApiKey.trim();
    if (typeof body.apifyApiToken === "string") patch.apifyApiToken = body.apifyApiToken.trim();
    const s = await saveGlobalSettings(patch);
    return NextResponse.json({
      edenApiKeyMasked: s.edenApiKeyMasked,
      edenRegion: s.edenRegion,
      modelAllowlist: s.modelAllowlist,
      hasKey: Boolean(s.edenApiKey),
      updatedAt: s.updatedAt,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const s = await saveGlobalSettings({ edenApiKey: "" });
    return NextResponse.json({ ok: true, hasKey: Boolean(s.edenApiKey) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

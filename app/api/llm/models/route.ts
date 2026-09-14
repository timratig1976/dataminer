import { NextRequest, NextResponse } from "next/server";
import { getCase, resolveEdenKey, resolveEdenRegion, getGlobalSettings } from "@/lib/db";
import { DEFAULT_MODEL_OPTIONS, mergeModelOptions } from "@/lib/model-options";
import { listEdenModels, type EdenModelInfo, type EdenRegion } from "@/lib/edenai";

/**
 * GET /api/llm/models — Eden AI model catalog (single provider).
 *
 * Model priority:
 *   1. Global settings modelAllowlist (curated by admin in /settings/models)
 *   2. Case-level modelAllowlist (legacy / override)
 *   3. Default model list fallback
 */
export async function GET(req: NextRequest) {
  const caseId = req.nextUrl.searchParams.get("caseId") || undefined;

  // Always load global settings first
  const globalSettings = await getGlobalSettings();
  const globalAllowlist: string[] = globalSettings.modelAllowlist ?? [];

  let edenKey = globalSettings.edenApiKey ?? await resolveEdenKey();
  let edenRegion: EdenRegion = globalSettings.edenRegion ?? await resolveEdenRegion();

  // Case-level overrides (key/region only — model list comes from global)
  let caseAllowlist: string[] = [];
  if (caseId) {
    const caseData = await getCase(caseId);
    if (!caseData) return NextResponse.json({ error: "Case not found" }, { status: 404 });
    if (caseData.edenApiKey) edenKey = caseData.edenApiKey;
    if (caseData.edenRegion) edenRegion = caseData.edenRegion as EdenRegion;
    caseAllowlist = caseData.modelAllowlist ?? [];
  }

  // Effective allowlist: global wins; case-level only used if global is empty
  const effectiveAllowlist = globalAllowlist.length > 0 ? globalAllowlist : caseAllowlist;

  let edenModels: string[] = [];
  const providerErrors: Record<string, string> = {};

  try {
    const models: EdenModelInfo[] = await listEdenModels(edenRegion, edenKey);
    edenModels = models.map((m) => m.id);
  } catch (e: unknown) {
    providerErrors.edenai = e instanceof Error ? e.message : String(e);
  }

  // If allowlist is set: show exactly those models (in order), else show defaults
  const enabledModels = effectiveAllowlist.length > 0
    ? effectiveAllowlist
    : [...DEFAULT_MODEL_OPTIONS];

  const allModels = mergeModelOptions([...edenModels, ...enabledModels], DEFAULT_MODEL_OPTIONS);

  return NextResponse.json({
    caseId: caseId ?? null,
    models: enabledModels,
    allModels,
    enabledModels,
    liveModels: edenModels,
    providerModels: { edenai: edenModels },
    providerErrors,
    keysPresent: { edenai: Boolean(edenKey) },
    edenRegion,
    globalAllowlist,
    providersByModel: Object.fromEntries(allModels.map((m) => [m, "edenai"])),
  });
}

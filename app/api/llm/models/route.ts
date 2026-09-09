import { NextRequest, NextResponse } from "next/server";
import { getCase, resolveEdenKey, resolveEdenRegion } from "@/lib/db";
import { DEFAULT_MODEL_OPTIONS, mergeModelOptions } from "@/lib/model-options";
import { listEdenModels, type EdenModelInfo, type EdenRegion } from "@/lib/edenai";

/**
 * GET /api/llm/models — Eden AI model catalog (single provider).
 * The catalog is public (no key required); region filters availability.
 */
export async function GET(req: NextRequest) {
  const caseId = req.nextUrl.searchParams.get("caseId") || undefined;
  let modelAllowlist: string[] = [];

  let edenKey = await resolveEdenKey();
  let edenRegion: EdenRegion = await resolveEdenRegion();

  if (caseId) {
    const caseData = await getCase(caseId);
    if (!caseData) return NextResponse.json({ error: "Case not found" }, { status: 404 });
    edenKey = await resolveEdenKey(caseData);
    edenRegion = await resolveEdenRegion(caseData);
    modelAllowlist = caseData.modelAllowlist ?? [];
  }

  let edenModels: string[] = [];
  const providerErrors: Record<string, string> = {};

  try {
    const models: EdenModelInfo[] = await listEdenModels(edenRegion, edenKey);
    edenModels = models.map((m) => m.id);
  } catch (e: unknown) {
    providerErrors.edenai = e instanceof Error ? e.message : String(e);
  }

  const allModels = mergeModelOptions([...edenModels, ...modelAllowlist], DEFAULT_MODEL_OPTIONS);
  const enabledModels = modelAllowlist.length > 0
    ? allModels.filter((m) => modelAllowlist.includes(m))
    : allModels;

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
    // every model goes through Eden — the provider prefix is informational only
    providersByModel: Object.fromEntries(allModels.map((m) => [m, "edenai"])),
  });
}

import { NextRequest, NextResponse } from "next/server";
import { getCase, resolveSearchKeys } from "@/lib/db";

export const runtime = "nodejs";

/**
 * GET /api/cases/[id]/agent/check-keys
 * Returns whether the required API keys for agent-based discovery are configured.
 * No secrets are returned — just booleans.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;
  const caseData = await getCase(caseId);
  if (!caseData) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  const searchKeys = await resolveSearchKeys();

  return NextResponse.json({
    edenConfigured: !!(caseData.edenApiKey || process.env.EDEN_API_KEY),
    firecrawlConfigured: !!searchKeys.firecrawlApiKey,
    serperConfigured: !!searchKeys.serperApiKey,
    serpApiConfigured: !!searchKeys.serpApiKey,
    braveConfigured: !!searchKeys.braveApiKey,
    apifyConfigured: !!searchKeys.apifyApiToken,
    anySearchConfigured: !!(
      searchKeys.serperApiKey ||
      searchKeys.serpApiKey ||
      searchKeys.braveApiKey ||
      searchKeys.apifyApiToken
    ),
    anyMapsConfigured: !!(
      searchKeys.serpApiKey ||
      searchKeys.serperApiKey ||
      searchKeys.apifyApiToken
    ),
  });
}
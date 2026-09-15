import { NextRequest, NextResponse } from "next/server";
import { resolveSearchKeys } from "@/lib/db";
import { searchViaSerpApi } from "@/lib/search";
import { searchViaBrave } from "@/lib/search";
import { mapsSearch } from "@/lib/maps";

export const runtime = "nodejs";

/**
 * POST /api/settings/test-search
 * Tests a search API key with a simple query.
 * Body: { provider: "serper" | "serp" | "brave", apiKey?: string }
 */
export async function POST(req: NextRequest) {
  const { provider, apiKey: bodyKey } = await req.json().catch(() => ({}));

  // Resolve key: body > DB > env
  const dbKeys = await resolveSearchKeys();
  const TEST_QUERY = "Handwerker Berlin";

  try {
    if (provider === "serper") {
      return NextResponse.json({ ok: false, error: "Serper nicht mehr unterstützt — SerpApi verwenden" });
    }

    if (provider === "serper-places") {
      return NextResponse.json({ ok: false, error: "Serper Places nicht mehr unterstützt — Maps via SerpApi verwenden" });
    }

    if (provider === "serp") {
      const key = bodyKey?.trim() || dbKeys.serpApiKey;
      if (!key) return NextResponse.json({ ok: false, error: "Kein SerpApi-Key konfiguriert" });
      const results = await searchViaSerpApi(TEST_QUERY, key, 3);
      return NextResponse.json({
        ok: results.length > 0,
        provider: "serpapi",
        hits: results.length,
        sample: results[0]?.title?.slice(0, 60) ?? "",
        note: "Google Web-Suche via SerpApi",
      });
    }

    if (provider === "brave") {
      const key = bodyKey?.trim() || dbKeys.braveApiKey;
      if (!key) return NextResponse.json({ ok: false, error: "Kein Brave-Key konfiguriert" });
      const results = await searchViaBrave(TEST_QUERY, key, 3);
      return NextResponse.json({
        ok: results.length > 0,
        provider: "brave",
        hits: results.length,
        sample: results[0]?.title?.slice(0, 60) ?? "",
        note: "Web-Suche via Brave Search",
      });
    }

    if (provider === "apify") {
      return NextResponse.json({ ok: false, error: "Apify nicht mehr unterstützt — Maps via SerpApi/Scrapling verwenden" });
    }

    return NextResponse.json({ ok: false, error: `Unbekannter Provider: ${provider}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message });
  }
}

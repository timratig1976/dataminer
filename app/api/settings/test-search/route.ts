import { NextRequest, NextResponse } from "next/server";
import { resolveSearchKeys } from "@/lib/db";
import { searchViaSerpApi, searchViaSerper } from "@/lib/search";
import { searchViaBrave } from "@/lib/search";
import { mapsSearch, mapsSearchViaSerper } from "@/lib/maps";

export const runtime = "nodejs";

/**
 * POST /api/settings/test-search
 * Tests a search API key with a simple query.
 * Body: { provider: "serper" | "serper-places" | "serp" | "brave" | "apify", apiKey?: string }
 */
export async function POST(req: NextRequest) {
  const { provider, apiKey: bodyKey, query: bodyQuery } = await req.json().catch(() => ({}));

  // Resolve key: body > DB > env
  const dbKeys = await resolveSearchKeys();
  const TEST_QUERY = bodyQuery?.trim() || "Handwerker Berlin";

  try {
    if (provider === "firecrawl") {
      const key = bodyKey?.trim() || dbKeys.firecrawlApiKey;
      if (!key) return NextResponse.json({ ok: false, error: "Kein Firecrawl-Key konfiguriert" });
      const { directFirecrawlScrape } = await import("@/lib/firecrawl");
      const result = await directFirecrawlScrape({ apiKey: key, url: "https://example.com" });
      return NextResponse.json({
        ok: Boolean(result.markdown),
        provider: "firecrawl",
        hits: 1,
        sample: result.title || "example.com erfolgreich gescrapt",
        note: "Direkte Firecrawl API (v1/scrape)",
      });
    }

    if (provider === "serper") {
      const key = bodyKey?.trim() || dbKeys.serperApiKey;
      if (!key) return NextResponse.json({ ok: false, error: "Kein Serper-Key konfiguriert" });
      const results = await searchViaSerper(TEST_QUERY, key, 3);
      return NextResponse.json({
        ok: results.length > 0,
        provider: "serper",
        hits: results.length,
        sample: results[0]?.title?.slice(0, 60) ?? "",
        note: "Google Web-Suche via Serper.dev",
      });
    }

    if (provider === "serper-places") {
      const key = bodyKey?.trim() || dbKeys.serperApiKey;
      if (!key) return NextResponse.json({ ok: false, error: "Kein Serper-Key konfiguriert" });
      // Split "Heizungsbauer München" → query:"Heizungsbauer" + location:"München"
      const parts = TEST_QUERY.split(" ");
      const serperQuery = parts.slice(0, -1).join(" ") || TEST_QUERY;
      const serperLocation = parts.length > 1 ? parts[parts.length - 1] : undefined;
      const places = await mapsSearchViaSerper({ query: serperQuery, location: serperLocation, limit: 3, serperApiKey: key });
      return NextResponse.json({
        ok: places.length > 0,
        provider: "serper-places",
        hits: places.length,
        count: places.length,
        results: places.slice(0, 3),
        sample: places[0]?.name?.slice(0, 60) ?? "",
        note: "Google Places via Serper.dev",
      });
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
      const key = bodyKey?.trim() || dbKeys.apifyApiToken;
      if (!key) return NextResponse.json({ ok: false, error: "Kein Apify-Token konfiguriert" });
      const result = await mapsSearch({ query: TEST_QUERY, limit: 3, provider: "maps-apify", apifyApiToken: key });
      const places = result.places;
      return NextResponse.json({
        ok: places.length > 0,
        provider: "apify",
        hits: places.length,
        sample: places[0]?.name?.slice(0, 60) ?? "",
        note: "Google Maps via Apify Actor",
      });
    }

    return NextResponse.json({ ok: false, error: `Unbekannter Provider: ${provider}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message });
  }
}

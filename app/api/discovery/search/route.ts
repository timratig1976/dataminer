import { NextRequest, NextResponse } from "next/server";
import { discoverySearch, normalizeDomain, type DiscoverySource } from "@/lib/discovery";
import { mapsSearch, type MapsProvider } from "@/lib/maps";
import { getExistingDomains, resolveSearchKeys } from "@/lib/db";

const VALID_SOURCES = new Set<string>([
  "auto", "firecrawl", "serpapi", "serper", "brave", "duckduckgo", "scrapling",
  "maps-serpapi", "maps-serper", "maps-apify", "maps-scrapling",
]);

const DISCOVERY_MAX_LIMIT = 100;

function clamp(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(Math.floor(n), DISCOVERY_MAX_LIMIT));
}

function getEnvOpts() {
  return {
    scraplingUrl: process.env.SCRAPLING_URL?.trim() || undefined,
    scraplingToken: process.env.SCRAPLING_TOKEN?.trim() || undefined,
    edenApiKey: process.env.EDEN_API_KEY?.trim() || undefined,
  };
}

/**
 * POST /api/discovery/search
 * Preview search — finds results WITHOUT writing anything.
 * Body: { query, source?, limit?, caseId?, ll?, excludeDomains? }
 * When caseId is provided, existing domains of that case are auto-excluded
 * (hits are flagged isDuplicate instead of removed).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const { query, source, limit, caseId, ll, excludeDomains } = body as Record<string, unknown>;
    return await runDiscovery(query, source, limit, caseId, ll, excludeDomains);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/discovery/search POST]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** GET /api/discovery/search?q=...&source=...&limit=...&caseId=...&ll=... */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    return await runDiscovery(
      sp.get("q"),
      sp.get("source"),
      sp.get("limit"),
      sp.get("caseId"),
      sp.get("ll"),
      null
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/discovery/search GET]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function runDiscovery(
  query: unknown,
  source: unknown,
  limit: unknown,
  caseId: unknown,
  ll: unknown,
  excludeDomains: unknown
) {
  const q = typeof query === "string" ? query.trim() : "";
  if (!q) {
    return NextResponse.json({ error: "query (string) required" }, { status: 400 });
  }

  const srcRaw = typeof source === "string" ? source : "auto";
  const src = VALID_SOURCES.has(srcRaw) ? (srcRaw as DiscoverySource) : "auto";
  const lim = clamp(limit, src.startsWith("maps") ? 20 : 30);

  // Merge client-provided exclusions with domains already stored in the case
  const exclusions = new Set<string>();
  if (typeof caseId === "string" && caseId) {
    for (const d of await getExistingDomains(caseId)) exclusions.add(d);
  }
  if (Array.isArray(excludeDomains)) {
    for (const d of excludeDomains) {
      if (typeof d === "string" && d.trim()) exclusions.add(d.trim().toLowerCase());
    }
  }
  const excludeList = Array.from(exclusions);

  const env = getEnvOpts();
  const searchKeys = await resolveSearchKeys();

  if (src === "maps-serpapi" || src === "maps-scrapling" || src === "maps-serper" || src === "maps-apify") {
    const resp = await mapsSearch({
      query: q,
      provider: src as MapsProvider,
      limit: lim,
      ll: typeof ll === "string" && ll.includes(",") ? ll : undefined,
      serpApiKey: searchKeys.serpApiKey,
      serperApiKey: searchKeys.serperApiKey,
      apifyApiToken: searchKeys.apifyApiToken,
      scraplingUrl: env.scraplingUrl,
      scraplingToken: env.scraplingToken,
      excludeDomains: excludeList,
    });
    return NextResponse.json({
      hits: resp.hits,
      places: resp.places,
      source: resp.provider,
      query: resp.query,
      latencyMs: resp.latencyMs,
      ...(resp.error ? { error: resp.error } : {}),
    });
  }

  // Web-search based discovery; for plain URLs typed into the box, treat as domain seed
  const directDomain = isPlainUrlOrDomain(q) ? normalizeDomain(q.startsWith("http") ? q : `https://${q}`) : "";
  if (directDomain) {
    return NextResponse.json({
      hits: [{
        title: directDomain,
        url: `https://${directDomain}`,
        domain: directDomain,
        snippet: "(direct URL/domain input)",
        isCatalog: false,
        isDuplicate: excludeList.includes(directDomain),
        searchQuery: q,
        searchSource: "direct",
      }],
      source: "direct",
      query: q,
      latencyMs: 0,
    });
  }

  const resp = await discoverySearch(q, {
    source: src,
    limit: lim,
    excludeDomains: excludeList,
    ...env,
    serpApiKey: searchKeys.serpApiKey,
    serperApiKey: searchKeys.serperApiKey,
    braveApiKey: searchKeys.braveApiKey,
  });
  return NextResponse.json(resp);
}

function isPlainUrlOrDomain(s: string): boolean {
  if (s.startsWith("http://") || s.startsWith("https://")) return true;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(s) && !s.includes(" ");
}

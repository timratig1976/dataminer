/**
 * lib/maps.ts
 * Google Maps local-results discovery.
 *
 * Providers:
 *   1. SerpApi  (engine=google_maps) — structured JSON: name, address, phone,
 *      website, rating, reviews. Uses the existing SERP_API_KEY (~1 credit/call).
 *   2. Scrapling sidecar (/maps/search) — free stealth scraping fallback.
 *
 * Maps hits carry the company name directly, so seed rows from Maps are
 * high-quality without any LLM call.
 */

import { isCatalogUrl } from "./search";
import { normalizeDomain, dedupeHits, type DiscoveryHit } from "./discovery";

// ── Types ────────────────────────────────────────────────────────────────────

export interface MapsPlace {
  name: string;
  address: string;
  phone: string;
  website: string;
  rating?: number;
  reviews?: number;
  category?: string;
  mapsUrl: string;
}

export type MapsProvider = "maps-serpapi" | "maps-serper" | "maps-apify" | "maps-scrapling";

export interface MapsSearchParams {
  query: string;
  provider?: MapsProvider;
  limit?: number;
  ll?: string;
  serpApiKey?: string;
  serperApiKey?: string;
  apifyApiToken?: string;
  scraplingUrl?: string;
  scraplingToken?: string;
  excludeDomains?: string[];
  signal?: AbortSignal;
}

export interface MapsSearchResponse {
  places: MapsPlace[];
  hits: DiscoveryHit[];
  provider: MapsProvider;
  query: string;
  latencyMs: number;
  error?: string;
}

const MAX_MAPS_LIMIT = 200;

// ── Provider 1: SerpApi google_maps ─────────────────────────────────────────

interface SerpMapsPlace {
  title?: string;
  name?: string;
  address?: string;
  full_address?: string;
  phone?: string;
  website?: string;
  rating?: number;
  reviews?: number;
  category?: string;
  link?: string;
  place_id?: string;
  data_cid?: string;
}

export async function mapsSearchViaSerpApi(params: {
  query: string;
  limit?: number;
  ll?: string;
  serpApiKey: string;
  signal?: AbortSignal;
}): Promise<MapsPlace[]> {
  const { query, limit = 20, ll, serpApiKey, signal } = params;
  if (!query.trim()) throw new Error("empty query");
  if (!serpApiKey.trim()) throw new Error("missing SERP_API_KEY for Maps");

  const sp = new URLSearchParams({
    engine: "google_maps",
    q: query,
    hl: "de",
    type: "search",
    api_key: serpApiKey,
  });
  const n = Math.max(1, Math.min(Math.floor(limit), 200));
  sp.set("num", String(n));
  if (ll) sp.set("ll", ll);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`SerpApi Maps timeout after 20000ms`)), 20_000);
  const combined = signal
    ? anySignal(signal, controller.signal)
    : controller.signal;

  let res: Response;
  try {
    res = await fetch(`https://serpapi.com/search.json?${sp}`, {
      headers: { Accept: "application/json" },
      signal: combined,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    try { await res.body?.cancel(); } catch {}
    throw new Error(`SerpApi Maps HTTP ${res.status}`);
  }

  const data = (await res.json()) as { local_results?: SerpMapsPlace[]; error?: string };
  const raw = data?.local_results ?? [];
  if (raw.length === 0 && data?.error && !/results/i.test(data.error)) {
    throw new Error(`SerpApi Maps: ${data.error}`);
  }

  return raw
    .map((p) => ({
      name: String(p.title ?? p.name ?? "").trim(),
      address: String(p.address ?? p.full_address ?? "").trim(),
      phone: String(p.phone ?? "").trim(),
      website: String(p.website ?? "").trim(),
      rating: typeof p.rating === "number" ? p.rating : undefined,
      reviews: typeof p.reviews === "number" ? p.reviews : undefined,
      category: String(p.category ?? "").trim() || undefined,
      mapsUrl: p.link ?? placeFallbackLink(p),
    }))
    .filter((p) => p.name);
}

function placeFallbackLink(p: SerpMapsPlace): string {
  const id = p.data_cid ?? p.place_id;
  return id
    ? `https://www.google.com/maps/place/?q=place_id:${id}`
    : `https://www.google.com/maps/search/${encodeURIComponent(String(p.title ?? p.name ?? ""))}`;
}

// ── Provider 2: Scrapling sidecar (free stealth scrape) ─────────────────────

interface ScraplingMapsPlace {
  name?: string;
  address?: string;
  phone?: string;
  website?: string;
  rating?: number;
  reviews?: number;
  category?: string;
  maps_url?: string;
}

export async function mapsSearchViaScrapling(params: {
  query: string;
  limit?: number;
  ll?: string;
  scraplingUrl: string;
  scraplingToken: string;
  signal?: AbortSignal;
}): Promise<MapsPlace[]> {
  const { query, limit = 20, ll, scraplingUrl, scraplingToken, signal } = params;
  if (!query.trim()) throw new Error("empty query");
  if (!scraplingUrl.trim()) throw new Error("missing SCRAPLING_URL for Maps");
  if (!scraplingToken.trim()) throw new Error("missing SCRAPLING_TOKEN for Maps");

  const controller = new AbortController();
  // Maps scroll-loading is slow — generous timeout
  const timer = setTimeout(() => controller.abort(new Error(`Scrapling Maps timeout after 120000ms`)), 120_000);

  let res: Response;
  try {
    res = await fetch(`${scraplingUrl.replace(/\/$/, "")}/maps/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-token": scraplingToken },
      body: JSON.stringify({
        query,
        max_results: Math.max(1, Math.min(Math.floor(limit), MAX_MAPS_LIMIT)),
        // MAX_MAPS_LIMIT = 200 — always request the maximum
        ll: ll ?? null,
      }),
      signal: signal ? anySignal(signal, controller.signal) : controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    try { await res.body?.cancel(); } catch {}
    throw new Error(`Scrapling Maps HTTP ${res.status}`);
  }

  const data = (await res.json()) as { places?: ScraplingMapsPlace[] };
  return (data.places ?? [])
    .map((p) => ({
      name: String(p.name ?? "").trim(),
      address: String(p.address ?? "").trim(),
      phone: String(p.phone ?? "").trim(),
      website: String(p.website ?? "").trim(),
      rating: typeof p.rating === "number" ? p.rating : undefined,
      reviews: typeof p.reviews === "number" ? p.reviews : undefined,
      category: String(p.category ?? "").trim() || undefined,
      mapsUrl: String(p.maps_url ?? "").trim(),
    }))
    .filter((p) => p.name);
}

// ── Provider 2: Serper.dev Google Places ──────────────────────────────────────

export async function mapsSearchViaSerper(params: {
  query: string;
  location?: string;  // city name, appended to query if provided
  limit: number;
  serperApiKey: string;
  signal?: AbortSignal;
}): Promise<MapsPlace[]> {
  const { query, location, limit, serperApiKey, signal } = params;
  // Serper uses the query string for geo — append location if provided
  const fullQuery = location ? `${query} ${location}` : query;
  const res = await fetch("https://google.serper.dev/places", {
    method: "POST",
    headers: { "X-API-KEY": serperApiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ q: fullQuery, gl: "de", hl: "de", num: Math.min(limit, 100) }),
    signal,
  });
  if (!res.ok) throw new Error(`Serper Places HTTP ${res.status}`);
  const data = await res.json() as {
    places?: Array<{ title?: string; address?: string; phone?: string; website?: string; rating?: number; ratingCount?: number; category?: string; cid?: string }>;
  };
  return (data.places ?? []).slice(0, limit).map(p => ({
    name: p.title ?? "",
    address: p.address ?? "",
    phone: p.phone ?? "",
    website: p.website ?? "",
    rating: p.rating,
    reviews: p.ratingCount,
    category: p.category,
    mapsUrl: p.cid
      ? `https://www.google.com/maps/place/?q=place_id:${p.cid}`
      : `https://www.google.com/maps/search/${encodeURIComponent(p.title ?? "")}`,
  }));
}

// ── Provider 3: Apify Google Maps Scraper ─────────────────────────────────────

export async function mapsSearchViaApify(params: {
  query: string;
  limit: number;
  apifyApiToken: string;
  signal?: AbortSignal;
}): Promise<MapsPlace[]> {
  const { query, limit, apifyApiToken, signal } = params;
  const BASE = "https://api.apify.com/v2";
  const ACTOR = "compass~crawler-google-places";
  const headers = { Authorization: `Bearer ${apifyApiToken}`, "Content-Type": "application/json" };

  // Start run
  const runRes = await fetch(`${BASE}/acts/${ACTOR}/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      searchStringsArray: [query],
      maxCrawledPlacesPerSearch: Math.min(limit, 400),
      language: "de",
      skipClosedPlaces: false,
    }),
    signal,
  });
  if (!runRes.ok) throw new Error(`Apify start HTTP ${runRes.status}`);
  const runData = await runRes.json() as { data: { id: string; defaultDatasetId: string } };
  const { id: runId, defaultDatasetId: datasetId } = runData.data;

  // Poll max 120s
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("Aborted");
    await new Promise(r => setTimeout(r, 3000));
    const s = await fetch(`${BASE}/actor-runs/${runId}`, { headers, signal });
    const sd = await s.json() as { data: { status: string } };
    const status = sd.data.status;
    if (status === "SUCCEEDED") break;
    if (["FAILED","ABORTED","TIMED-OUT"].includes(status)) throw new Error(`Apify run ${status}`);
  }

  // Fetch results
  const itemsRes = await fetch(`${BASE}/datasets/${datasetId}/items?clean=true&format=json&limit=${limit}`, { headers, signal });
  if (!itemsRes.ok) throw new Error(`Apify dataset HTTP ${itemsRes.status}`);
  const items = await itemsRes.json() as Array<{ title?: string; address?: string; phone?: string; website?: string; totalScore?: number; reviewsCount?: number; categoryName?: string; url?: string }>;

  return items.map(p => ({
    name: p.title ?? "",
    address: p.address ?? "",
    phone: p.phone ?? "",
    website: p.website ?? "",
    rating: p.totalScore,
    reviews: p.reviewsCount,
    category: p.categoryName,
    mapsUrl: p.url ?? "",
  })).filter(p => p.name);
}

// ── Orchestration ────────────────────────────────────────────────────────────

export async function mapsSearch(params: MapsSearchParams): Promise<MapsSearchResponse> {
  const {
    query,
    provider = "maps-serpapi",
    limit = 20,
    ll,
    serpApiKey,
    serperApiKey,
    apifyApiToken,
    scraplingUrl,
    scraplingToken,
    excludeDomains = [],
    signal,
  } = params;

  const clampedLimit = Math.max(1, Math.min(limit, MAX_MAPS_LIMIT));
  const t0 = Date.now();

  let effectiveProvider: MapsProvider = provider;
  let places: MapsPlace[] = [];
  let error: string | undefined;

  const trySerp = async (): Promise<boolean> => {
    if (!serpApiKey) return false;
    try { places = await mapsSearchViaSerpApi({ query, limit: clampedLimit, ll, serpApiKey, signal }); effectiveProvider = "maps-serpapi"; return places.length > 0; }
    catch (e) { error = (e as Error).message; return false; }
  };
  const trySerper = async (): Promise<boolean> => {
    if (!serperApiKey) return false;
    try { places = await mapsSearchViaSerper({ query, location: ll, limit: clampedLimit, serperApiKey, signal }); effectiveProvider = "maps-serper"; return places.length > 0; }
    catch (e) { error = `${error ? error + "; " : ""}${(e as Error).message}`; return false; }
  };
  const tryApify = async (): Promise<boolean> => {
    if (!apifyApiToken) return false;
    try { places = await mapsSearchViaApify({ query, limit: clampedLimit, apifyApiToken, signal }); effectiveProvider = "maps-apify"; return places.length > 0; }
    catch (e) { error = `${error ? error + "; " : ""}${(e as Error).message}`; return false; }
  };
  const tryScrapling = async (): Promise<boolean> => {
    if (!scraplingUrl || !scraplingToken) return false;
    try { places = await mapsSearchViaScrapling({ query, limit: clampedLimit, ll, scraplingUrl, scraplingToken, signal }); effectiveProvider = "maps-scrapling"; return places.length > 0; }
    catch (e) { error = `${error ? error + "; " : ""}${(e as Error).message}`; return false; }
  };

  if (provider === "maps-apify") {
    if (!(await tryApify())) await trySerper() || await tryScrapling();
  } else if (provider === "maps-serper") {
    if (!(await trySerper())) await tryApify() || await tryScrapling();
  } else if (provider === "maps-scrapling") {
    if (!(await tryScrapling())) effectiveProvider = "maps-scrapling";
  } else {
    // Default: SerpApi → Serper → Apify → Scrapling
    await trySerp() || await trySerper() || await tryApify() || await tryScrapling();
  }

  const hits = placesToHits(places, query, effectiveProvider, excludeDomains);
  return {
    places,
    hits,
    provider: effectiveProvider,
    query,
    latencyMs: Date.now() - t0,
    ...(places.length === 0 && error ? { error } : {}),
  };
}

export function placesToHits(
  places: MapsPlace[],
  query: string,
  provider: string,
  excludeDomains: string[] = []
): DiscoveryHit[] {
  const excludeSet = new Set(excludeDomains.map((d) => d.toLowerCase().trim()).filter(Boolean));
  const hits: DiscoveryHit[] = places.map((p) => {
    // Prefer the company website as canonical URL; maps link as fallback
    const canonicalUrl = p.website.startsWith("http")
      ? p.website
      : (p.website ? `https://${p.website}` : p.mapsUrl);
    const domain = p.website.startsWith("http") || p.website.includes(".")
      ? normalizeDomain(p.website.startsWith("http") ? p.website : `https://${p.website}`)
      : "";

    const snippetParts = [
      p.category,
      p.address,
      p.rating != null ? `★ ${p.rating}${p.reviews != null ? ` (${p.reviews})` : ""}` : "",
      p.phone,
    ].filter(Boolean);

    return {
      title: p.name,
      url: canonicalUrl,
      domain,
      snippet: snippetParts.join(" · "),
      isCatalog: false, // Maps results are always real businesses, never directories
      isDuplicate: !!domain && excludeSet.has(domain),
      searchQuery: query,
      searchSource: provider,
    };
  });
  // Two places can share a website domain (e.g. same company, 2 branches) —
  // keep both but mark the later ones as duplicates for review
  const seen = new Set<string>();
  for (const h of hits) {
    if (h.domain) {
      if (seen.has(h.domain)) h.isDuplicate = true;
      seen.add(h.domain);
    }
  }
  return hits;
}

/** Maps seed rows carry extra structured data compared to plain web hits. */
export function placeToSeedExtras(p: MapsPlace): Record<string, string> {
  return {
    address: p.address,
    phone: p.phone,
    maps_url: p.mapsUrl,
    maps_rating: p.rating != null ? String(p.rating) : "",
    maps_reviews: p.reviews != null ? String(p.reviews) : "",
    category: p.category ?? "",
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Combine two AbortSignals (first one to fire wins). */
function anySignal(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (typeof AbortSignal.any === "function") return AbortSignal.any([a, b]);
  // Polyfill for older runtimes
  const controller = new AbortController();
  const onAbort = () => controller.abort(a.aborted ? a.reason : b.reason);
  if (a.aborted || b.aborted) {
    controller.abort(a.aborted ? a.reason : b.reason);
    return controller.signal;
  }
  a.addEventListener("abort", onAbort, { once: true });
  b.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}

export { dedupeHits };

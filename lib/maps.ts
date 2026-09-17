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
  const { query, limit = 100, ll, serpApiKey, signal } = params;
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
  const { query, limit = 100, ll, scraplingUrl, scraplingToken, signal } = params;
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
  location?: string;  // city name — passed as separate `location` param, NOT appended to query
  limit: number;
  serperApiKey: string;
  signal?: AbortSignal;
}): Promise<MapsPlace[]> {
  const { query, location, limit, serperApiKey, signal } = params;
  // IMPORTANT: Serper Places requires location as a separate param, NOT appended to query.
  // "Heizungsbauer Aachen" → 0 results. "Heizungsbauer" + location:"Aachen" → correct results.
  const body: Record<string, unknown> = { q: query, gl: "de", hl: "de", num: Math.min(limit, 100) };
  if (location) body.location = location;
  const res = await fetch("https://google.serper.dev/places", {
    method: "POST",
    headers: { "X-API-KEY": serperApiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`Serper Places HTTP ${res.status}`);
  const data = await res.json() as {
    places?: Array<{ title?: string; address?: string; phone?: string; phoneNumber?: string; website?: string; rating?: number; ratingCount?: number; category?: string; cid?: string }>;
  };
  const places = (data.places ?? []).slice(0, limit).map(p => ({
    name: p.title ?? "",
    address: p.address ?? "",
    phone: p.phoneNumber ?? p.phone ?? "",
    website: p.website ?? "",
    rating: p.rating,
    reviews: p.ratingCount,
    category: p.category,
    mapsUrl: p.cid
      ? `https://www.google.com/maps/place/?q=place_id:${p.cid}`
      : `https://www.google.com/maps/search/${encodeURIComponent(p.title ?? "")}`,
  }));

  // Serper Places has limited DE coverage — if empty, fall back to organic search
  // Use site-exclusion operators to prefer actual company websites over directories/articles
  if (places.length === 0) {
    const localQuery = `${fullQuery} -site:wikipedia.org -site:statista.com -site:linkedin.com -site:xing.com -site:kununu.com`;
    const searchRes = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": serperApiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: localQuery, gl: "de", hl: "de", num: Math.min(limit, 10) }),
      signal,
    });
    if (searchRes.ok) {
      const searchData = await searchRes.json() as {
        organic?: Array<{ title?: string; link?: string; snippet?: string }>;
      };
      return (searchData.organic ?? []).slice(0, limit).map(r => ({
        name: r.title ?? "",
        address: "",
        phone: "",
        website: r.link ?? "",
        mapsUrl: "",
      }));
    }
  }

  return places;
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
  const ACTOR = "compass/crawler-google-places";
  const headers = { Authorization: `Bearer ${apifyApiToken}`, "Content-Type": "application/json" };

  // Start run
  const runRes = await fetch(`${BASE}/acts/${ACTOR.replace("/","~")}/runs`, {
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
    limit = 100,
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

  // ── Stacking strategy ──
  // Apify: best DE coverage, structured data (name/address/phone/website), 100+ results
  //        but slow (30-120s). Use when available — always wins on quality.
  // SerpApi: fast, structured, 20-80 results per call. Good fallback.
  // Serper /places: poor DE coverage → falls back to /search internally (10 organic results).
  //        Fast but shallow. Use only when nothing else available.
  // Scrapling: free, slow, unreliable. Last resort.
  //
  // DEFAULT STACK: Apify → SerpApi → Serper → Scrapling (first with results wins)

  if (provider === "maps-apify") {
    if (!(await tryApify())) await trySerp() || await trySerper() || await tryScrapling();
  } else if (provider === "maps-serper") {
    if (!(await trySerper())) await tryApify() || await trySerp() || await tryScrapling();
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

// ── Deep Maps detail fetch (Apify) ────────────────────────────────────────────

export interface MapsPlaceDetails {
  name?: string;
  address?: string;
  street?: string;
  city?: string;
  postalCode?: string;
  phone?: string;
  website?: string;
  rating?: number;
  reviews?: number;
  ratingDistribution?: string;   // e.g. "5★:8 4★:2 3★:1"
  categories?: string[];          // all categories from SerpAPI
  category?: string;              // primary category
  description?: string;
  openingHours?: string;
  openState?: string;             // "Geöffnet" / "Geschlossen"
  photosCount?: number;
  hasOwnerResponse?: boolean;
  claimedByOwner?: boolean;
  userReviewSamples?: string;     // 2-3 sample reviews from SerpAPI
  directUrl?: string;
  placeId?: string;
  dataCid?: string;
  /** Structured attributes from the Info tab: accessibility, payments, highlights etc. */
  additionalInfo?: string;
  /** Whether the place is permanently or temporarily closed */
  closedState?: string;
  /** Number of Q&A entries */
  questionsAndAnswersCount?: number;
  rawJson?: Record<string, unknown>;
}

/**
 * Fetch deep Google Maps place details via Apify compass/crawler-google-places.
 * Uses searchStringsArray with company name + city for reliable matching.
 */
export async function fetchMapsDetails(params: {
  mapsUrl: string;
  companyName?: string;
  city?: string;
  apifyApiToken: string;
  signal?: AbortSignal;
}): Promise<MapsPlaceDetails> {
  const { mapsUrl, companyName, city, apifyApiToken, signal } = params;
  const BASE = "https://api.apify.com/v2";
  const ACTOR = "compass~crawler-google-places";
  const headers = { Authorization: `Bearer ${apifyApiToken}`, "Content-Type": "application/json" };

  const searchQuery = companyName
    ? (city ? `${companyName} ${city}` : companyName)
    : mapsUrl;

  const runRes = await fetch(`${BASE}/acts/${ACTOR}/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      searchStringsArray: [searchQuery],
      maxCrawledPlaces: 1,
      language: "de",
      includeOpeningHours: true,
      includeImages: false,
    }),
    signal,
  });
  if (!runRes.ok) throw new Error(`Apify detail start HTTP ${runRes.status}`);
  const runData = await runRes.json() as { data: { id: string; defaultDatasetId: string } };
  const { id: runId, defaultDatasetId: datasetId } = runData.data;

  // Poll max 90s
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("Aborted");
    await new Promise(r => setTimeout(r, 3000));
    const s = await fetch(`${BASE}/actor-runs/${runId}`, { headers, signal });
    const sd = await s.json() as { data: { status: string } };
    if (sd.data.status === "SUCCEEDED") break;
    if (["FAILED","ABORTED","TIMED-OUT"].includes(sd.data.status)) throw new Error(`Apify ${sd.data.status}`);
  }

  const itemsRes = await fetch(`${BASE}/datasets/${datasetId}/items?clean=true&format=json&limit=1`, { headers, signal });
  if (!itemsRes.ok) throw new Error(`Apify dataset HTTP ${itemsRes.status}`);
  const items = await itemsRes.json() as Array<Record<string, unknown>>;
  const p = items[0];
  if (!p) throw new Error("Apify: no result");

  const dist = p.reviewsDistribution as Record<string, number> | undefined;
  const ratingDist = dist
    ? Object.entries(dist).map(([k, v]) => `${k}★:${v}`).join(" ")
    : undefined;

  // Apify openingHours is an array of {day, hours} objects
  const ohRaw = p.openingHours;
  const openingHours = Array.isArray(ohRaw)
    ? (ohRaw as Array<Record<string, string>>).map(h => `${h.day ?? h.dayOfWeek ?? Object.keys(h)[0]}: ${h.hours ?? h.timeFrom ?? Object.values(h)[0]}`).join(", ")
    : (typeof ohRaw === "string" ? ohRaw : undefined);

  return {
    name: p.title as string | undefined,
    address: p.address as string | undefined,
    street: p.street as string | undefined,
    city: p.city as string | undefined,
    postalCode: p.postalCode as string | undefined,
    phone: p.phone as string | undefined,
    website: p.website as string | undefined,
    rating: p.totalScore as number | undefined,
    reviews: p.reviewsCount as number | undefined,
    ratingDistribution: ratingDist,
    categories: [p.categoryName as string].filter(Boolean) as string[],
    category: p.categoryName as string | undefined,
    description: p.description as string | undefined,
    openingHours,
    photosCount: p.imagesCount as number | undefined,
    hasOwnerResponse: !!(p.reviewsDistribution && p.ownerResponse),
    claimedByOwner: p.claimThisBusiness != null ? !(p.claimThisBusiness as boolean) : undefined,
    directUrl: p.url as string | undefined,
    placeId: p.placeId as string | undefined,
    additionalInfo: (() => {
      const ai = p.additionalInfo as Record<string, Array<Record<string, boolean>>> | undefined;
      if (!ai) return undefined;
      const lines: string[] = [];
      for (const [section, attrs] of Object.entries(ai)) {
        const active = attrs.flatMap(a => Object.entries(a).filter(([,v]) => v).map(([k]) => k));
        if (active.length) lines.push(`${section}: ${active.join(', ')}`);
      }
      return lines.length ? lines.join(' | ') : undefined;
    })(),
    closedState: p.permanentlyClosed ? 'Dauerhaft geschlossen' : p.temporarilyClosed ? 'Vorübergehend geschlossen' : undefined,
    questionsAndAnswersCount: Array.isArray(p.questionsAndAnswers) ? (p.questionsAndAnswers as unknown[]).length : undefined,
    rawJson: p,
  };
}

/**
 * Fetch Maps place details combining Apify (description, photos, city/PLZ) +
 * SerpAPI (all categories, open_state, rating_summary, sample reviews).
 * Both run in parallel; result is merged — best of both.
 */
export async function fetchMapsDetailsEnriched(params: {
  mapsUrl: string;
  companyName?: string;
  city?: string;
  apifyApiToken: string;
  serpApiKey?: string;
  signal?: AbortSignal;
}): Promise<MapsPlaceDetails> {
  const { serpApiKey, mapsUrl, companyName, city, apifyApiToken, signal } = params;

  const [apifyResult, serpResult] = await Promise.allSettled([
    fetchMapsDetails({ mapsUrl, companyName, city, apifyApiToken, signal }),
    serpApiKey
      ? fetchMapsDetailsSerpApi({ mapsUrl, companyName, serpApiKey, signal })
      : Promise.reject("no serp key"),
  ]);

  const apify = apifyResult.status === "fulfilled" ? apifyResult.value : null;
  const serp  = serpResult.status  === "fulfilled" ? serpResult.value  : null;
  if (!apify && !serp) throw new Error("Both Apify and SerpAPI failed");

  return {
    name:              serp?.name       ?? apify?.name,
    address:           serp?.address    ?? apify?.address,
    street:            apify?.street,
    city:              apify?.city,
    postalCode:        apify?.postalCode,
    phone:             serp?.phone      ?? apify?.phone,
    website:           serp?.website    ?? apify?.website,
    rating:            serp?.rating     ?? apify?.rating,
    reviews:           serp?.reviews    ?? apify?.reviews,
    ratingDistribution: serp?.ratingDistribution ?? apify?.ratingDistribution,
    categories:        (serp?.categories?.length ? serp.categories : apify?.categories),
    category:          serp?.categories?.[0] ?? apify?.category,
    description:       apify?.description,
    openingHours:      serp?.openingHours ?? apify?.openingHours,
    openState:         serp?.openState,
    photosCount:       apify?.photosCount,
    hasOwnerResponse:  apify?.hasOwnerResponse,
    claimedByOwner:    apify?.claimedByOwner,
    userReviewSamples: serp?.userReviewSamples,
    directUrl:         apify?.directUrl ?? serp?.directUrl,
    placeId:           serp?.placeId    ?? apify?.placeId,
    additionalInfo:    apify?.additionalInfo,
    closedState:       apify?.closedState,
    questionsAndAnswersCount: apify?.questionsAndAnswersCount,
    rawJson:           apify?.rawJson,
  };
}

/**
 * Fetch all Google Maps locations for a company by name (without city).
 * Returns the total count + the "main" location (most reviews).
 * Used to identify multi-location chains for ViLocal pitch.
 */
export async function fetchMapsLocationCount(params: {
  companyName: string;
  apifyApiToken: string;
  maxLocations?: number;
  signal?: AbortSignal;
}): Promise<{ count: number; hitLimit: boolean; mainLocation?: { name?: string; address?: string; city?: string; phone?: string; rating?: number; reviews?: number; directUrl?: string } }> {
  const { companyName, apifyApiToken, maxLocations = 20, signal } = params;
  const BASE = "https://api.apify.com/v2";
  const ACTOR = "compass~crawler-google-places";
  const headers = { Authorization: `Bearer ${apifyApiToken}`, "Content-Type": "application/json" };

  const runRes = await fetch(`${BASE}/acts/${ACTOR}/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      searchStringsArray: [companyName],
      maxCrawledPlaces: maxLocations,
      language: "de",
      includeOpeningHours: false,
      includeImages: false,
    }),
    signal,
  });
  if (!runRes.ok) throw new Error(`Apify location-count start HTTP ${runRes.status}`);
  const runData = await runRes.json() as { data: { id: string; defaultDatasetId: string } };
  const { id: runId, defaultDatasetId: datasetId } = runData.data;

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("Aborted");
    await new Promise(r => setTimeout(r, 3000));
    const s = await fetch(`${BASE}/actor-runs/${runId}`, { headers, signal });
    const sd = await s.json() as { data: { status: string } };
    if (sd.data.status === "SUCCEEDED") break;
    if (["FAILED","ABORTED","TIMED-OUT"].includes(sd.data.status)) throw new Error(`Apify ${sd.data.status}`);
  }

  const itemsRes = await fetch(`${BASE}/datasets/${datasetId}/items?clean=true&format=json&limit=${maxLocations}`, { headers, signal });
  if (!itemsRes.ok) throw new Error(`Apify dataset HTTP ${itemsRes.status}`);
  const items = await itemsRes.json() as Array<Record<string, unknown>>;
  if (!items.length) return { count: 0, hitLimit: false };

  // Main location = most reviews
  const sorted = [...items].sort((a, b) => ((b.reviewsCount as number) ?? 0) - ((a.reviewsCount as number) ?? 0));
  const main = sorted[0];

  return {
    count: items.length,
    hitLimit: items.length >= maxLocations,
    mainLocation: {
      name: main.title as string | undefined,
      address: main.address as string | undefined,
      city: main.city as string | undefined,
      phone: main.phone as string | undefined,
      rating: main.totalScore as number | undefined,
      reviews: main.reviewsCount as number | undefined,
      directUrl: main.url as string | undefined,
    },
  };
}

async function fetchMapsDetailsSerpApi(params: {
  mapsUrl: string;
  companyName?: string;
  serpApiKey: string;
  signal?: AbortSignal;
}): Promise<MapsPlaceDetails> {
  const { mapsUrl, companyName, serpApiKey } = params;
  const placeIdMatch = mapsUrl.match(/place_id[=:]([A-Za-z0-9_-]+)/);

  const sp = new URLSearchParams({ engine: "google_maps", api_key: serpApiKey, type: "place", hl: "de", gl: "de" });
  if (placeIdMatch) sp.set("place_id", placeIdMatch[1]);
  else if (companyName) { sp.set("q", companyName); sp.set("type", "search"); }

  const res = await fetch(`https://serpapi.com/search?${sp}`);
  if (!res.ok) throw new Error(`SerpAPI HTTP ${res.status}`);
  const json = await res.json() as Record<string, unknown>;
  const p = (json.place_results ?? (json.local_results as Array<unknown>)?.[0]) as Record<string, unknown> | undefined;
  if (!p) throw new Error("SerpAPI: no result");

  const hoursArr = Array.isArray(p.hours)
    ? (p.hours as Array<Record<string, string>>).map(h => { const [d, t] = Object.entries(h)[0]; return `${d}: ${t}`; }).join(", ")
    : undefined;
  const dist = Array.isArray(p.rating_summary)
    ? (p.rating_summary as Array<{stars?:number;amount?:number}>).map(d => `${d.stars}★:${d.amount}`).join(" ")
    : undefined;
  const samples = Array.isArray(p.user_reviews)
    ? (p.user_reviews as Array<{name?:string;rating?:number;description?:string}>).slice(0,3)
        .map(r => `★${r.rating} ${r.name}: ${(r.description ?? "").slice(0,100)}`).join("\n")
    : undefined;

  return {
    name: p.title as string | undefined,
    address: p.address as string | undefined,
    phone: p.phone as string | undefined,
    website: p.website as string | undefined,
    rating: p.rating as number | undefined,
    reviews: p.reviews as number | undefined,
    ratingDistribution: dist,
    categories: Array.isArray(p.type) ? p.type as string[] : (p.type ? [p.type as string] : undefined),
    category: Array.isArray(p.type) ? (p.type as string[])[0] : p.type as string | undefined,
    openingHours: hoursArr,
    openState: p.open_state as string | undefined,
    userReviewSamples: samples,
    placeId: p.place_id as string | undefined,
  };
}

// ── SerpAPI Reviews fetch ─────────────────────────────────────────────────────

export interface MapsReview {
  author: string;
  rating: number;
  text: string;
  date: string;
  ownerReply?: string;
}

/**
 * Fetch recent Google Maps reviews via Apify google-maps-reviews-scraper.
 * Works with place_id URLs like: https://www.google.com/maps/place/?q=place_id:12345
 */
export async function fetchMapsReviews(params: {
  mapsUrl: string;
  apifyApiToken: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<{ reviews: MapsReview[]; totalReviews?: number }> {
  const { mapsUrl, apifyApiToken, limit = 10, signal } = params;
  const BASE = "https://api.apify.com/v2";
  const ACTOR = "compass/Google-Maps-Reviews-Scraper";
  const headers = { Authorization: `Bearer ${apifyApiToken}`, "Content-Type": "application/json" };
  const ACTOR_URL_R = ACTOR.replace("/", "~");

  // Extract place_id from our URL format: ?q=place_id:12345
  const placeIdMatch = mapsUrl.match(/place_id[=:](\d+)/);
  const placeId = placeIdMatch?.[1];

  const runRes = await fetch(`${BASE}/acts/${ACTOR.replace("/","~")}/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      startUrls: [{ url: mapsUrl }],
      ...(placeId ? { placeIds: [placeId] } : {}),
      maxReviews: Math.min(limit, 20),
      reviewsSort: "newestFirst",
      language: "de",
    }),
    signal,
  });
  if (!runRes.ok) throw new Error(`Apify reviews start HTTP ${runRes.status}`);
  const runData = await runRes.json() as { data: { id: string; defaultDatasetId: string } };
  const { id: runId, defaultDatasetId: datasetId } = runData.data;

  // Poll max 60s
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("Aborted");
    await new Promise(r => setTimeout(r, 3000));
    const s = await fetch(`${BASE}/actor-runs/${runId}`, { headers, signal });
    const sd = await s.json() as { data: { status: string } };
    if (sd.data.status === "SUCCEEDED") break;
    if (["FAILED","ABORTED","TIMED-OUT"].includes(sd.data.status)) throw new Error(`Apify reviews ${sd.data.status}`);
  }

  const itemsRes = await fetch(`${BASE}/datasets/${datasetId}/items?clean=true&format=json&limit=${limit}`, { headers, signal });
  if (!itemsRes.ok) throw new Error(`Apify reviews dataset HTTP ${itemsRes.status}`);
  const items = await itemsRes.json() as Array<Record<string, unknown>>;

  const reviews: MapsReview[] = items.map(r => ({
    author: (r.name ?? r.authorName ?? "Unknown") as string,
    rating: (r.stars ?? r.rating ?? 0) as number,
    text: (r.text ?? r.snippet ?? "") as string,
    date: (r.publishedAtDate ?? r.date ?? "") as string,
    ownerReply: (r.responseFromOwnerText ?? undefined) as string | undefined,
  }));

  return { reviews, totalReviews: reviews.length };
}

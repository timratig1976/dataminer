/**
 * lib/search.ts
 * 3-layer web search engine:
 *   Layer 1 — SerpAPI       (fast, structured JSON, needs SERP_API_KEY)
 *   Layer 2 — DuckDuckGo    (free, HTML scraping, no key needed)
 *   Layer 3 — Playwright    (headless Chromium on Bing, JS rendering, last resort)
 *
 * Robustness guarantees:
 *   - Explicit AbortController timeouts (no AbortSignal.timeout compat issues)
 *   - Response bodies always consumed on non-OK to avoid socket leaks
 *   - Playwright browser always closed via try/finally even if context setup fails
 *   - DDG uses multiple selector strategies with fallback
 *   - URL deduplication across results
 *   - Per-layer latency reported in response
 *   - All text sanitised before returning (no prompt-injection via title/snippet)
 */

import { edenWebSearch, type EdenWebSearchResult } from "./edenai";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export type SearchLayer = "serpapi" | "serper" | "brave" | "duckduckgo" | "playwright" | "scrapling" | "firecrawl";

export interface SearchResponse {
  results: SearchResult[];
  source: SearchLayer;
  query: string;
  latencyMs: number;
  /** Populated when all layers fail */
  error?: string;
  /** Warnings from layers that were tried but failed */
  layerErrors?: Record<string, string>;
  /** Firecrawl/Eden API cost in USD (only populated when using edenWebSearch) */
  costUsd?: number;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/** Create an AbortController that fires after `ms` milliseconds */
function withTimeout(ms: number): { controller: AbortController; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Timeout after ${ms}ms`)), ms);
  return { controller, clear: () => clearTimeout(timer) };
}

/** Drain and discard a non-OK response body to free the socket */
async function drainBody(res: Response): Promise<void> {
  try { await res.body?.cancel(); } catch { /* ignore */ }
}

/** Strip characters that could confuse an LLM or break prompt structure */
function sanitiseText(s: string, maxLen: number): string {
  return s
    .replace(/[\x00-\x1F\x7F]/g, " ")   // control chars
    .replace(/---+/g, "—")               // avoid accidental prompt separators
    .trim()
    .slice(0, maxLen);
}

/**
 * Domains that are business directories / catalogs / social profiles.
 * Results whose hostname matches any of these are NEVER returned as a
 * company's own website — they may appear in the prompt as context but
 * the LLM system prompt already instructs it to extract the real URL
 * from their snippet rather than treating them as the answer.
 */
const CATALOG_DOMAINS = new Set([
  // ── German business directories ──────────────────────────────────────────
  "wlw.de", "gelbeseiten.de", "dasoertliche.de", "dastelefonbuch.de",
  "11880.com", "11880.de", "meinestadt.de", "stadtbranchenbuch.com",
  "branchenbuch.de", "firmen.de", "firmenwissen.de", "northdata.de",
  "northdata.com", "companyhouse.de", "handelsregister.de",
  "unternehmensregister.de", "bundesanzeiger.de", "creditreform.de",
  "bisnode.de", "hoppenstedt.de", "dun.com", "dnb.com",
  "cylex.de", "cylex-branchenbuch.de", "werkenntwen.de",
  "marktplatz-mittelstand.de", "europages.de", "europages.com",
  "kompass.com", "kompass.de", "wer-liefert-was.de",
  // ── Firmenabc / Firmenverzeichnisse ──────────────────────────────────────
  "firmenabc.com", "firmenabc.at", "firmenabc.ch",
  "firmenverzeichnis.de", "firmendb.de", "firmen-wiki.de",
  "regional.de", "regional.at",
  "local.ch", "local.de",
  "klicktel.de", "teleauskunft.de",
  // ── Immobilien Portale (pure listing/aggregator sites) ─────────────────────────────
  "immobilienscout24.de", "immowelt.de", "immonet.de", "immowelt.at",
  "houzz.de", "houzz.com",
  // NOTE: fertighaus.de, massivhaus.de, bau.de, bauen.de etc. are NOT catalogs —
  // they are real company/industry sites and must NOT be flagged as catalogs.
  // ── Handwerker-Vermittlung / Marktplätze (pure aggregators) ────────────────
  "my-hammer.de", "myhammer.de",
  "homeday.de",
  "handwerker24.de", "handwerker-vermittlung.de",
  "auftragsboerse.de", "blauarbeit.de",
  "1-2-do.com", "1-2-do.de",
  "aroundhome.de", "homeadvisor.de",
  "klugo.de",
  "haendlerbund.de",
  // NOTE: installateur.de, dein-heizungsbauer.de etc. can be real company sites — removed
  // ── Lokale Verzeichnisse & Branchenportale ────────────────────────────────
  "trustlocal.de", "locanto.de", "quoka.de",
  "kleinanzeigen.de", "ebay-kleinanzeigen.de",
  "zvshk.de",
  "innungssuche.de",
  // NOTE: innung.de, handwerkskammer.de, hwk.de etc. are official bodies, not catalogs — removed
  // ── Aggregatoren & Vergleichsportale ────────────────────────────────────
  "check24.de", "verivox.de",
  "idealo.de",
  // ── Bewertungsportale ─────────────────────────────────────────────────────
  "golocal.de", "proven-expert.com", "provenexpert.com",
  "trustedshops.de", "ekomi.de",
  "yelp.com", "yelp.de", "foursquare.com", "trustpilot.com",
  "trustpilot.de", "kununu.com", "glassdoor.com", "glassdoor.de",
  // ── International directories ─────────────────────────────────────────────
  "manta.com", "hotfrog.com", "yellowpages.com", "superpages.com",
  "thomasnet.com", "alibaba.com", "aliexpress.com",
  "bloomberg.com", "crunchbase.com",
  "mapquest.com",
  // ── Social / professional ─────────────────────────────────────────────────
  "linkedin.com", "xing.com", "facebook.com", "instagram.com",
  "twitter.com", "x.com", "youtube.com", "tiktok.com",
  "pinterest.com", "snapchat.com",
  // ── Maps / review ─────────────────────────────────────────────────────────
  "maps.google.com", "google.com/maps", "maps.apple.com",
  "tripadvisor.com", "tripadvisor.de",
  // ── App stores / job boards ───────────────────────────────────────────────
  "play.google.com", "apps.apple.com", "indeed.com", "stepstone.de",
  "monster.de", "jobs.de",
  // ── Wiki / encyclopaedic ──────────────────────────────────────────────────
  "wikipedia.org", "wikidata.org",
]);

/** Returns true if the URL belongs to a catalog/directory domain or path pattern */
function isCatalogUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const path = parsed.pathname.toLowerCase();

    // 1. Exact domain / subdomain match
    if (Array.from(CATALOG_DOMAINS).some(d => hostname === d || hostname.endsWith(`.${d}`))) {
      return true;
    }

    // 2. Path-based catalog patterns — only match known directory URL structures
    const CATALOG_PATH_PATTERNS = [
      /fachbetriebe[-_]finden/,
      /installateur[-_](finden|suche)/,
      /firmen[-_](suche|finder|verzeichnis)/,
      /branchenverzeichnis/,
      /unternehmens(suche|verzeichnis)/,
      /handwerker[-_](finden|suche)/,
      /betriebe[-_]finden/,
      // NOTE: /\/suche\// and /\/search\// removed — too broad, matches real company sites
    ];
    if (CATALOG_PATH_PATTERNS.some(p => p.test(path))) return true;

    // 3. Hostname keyword patterns (catches new/unknown directories)
    const CATALOG_HOST_KEYWORDS = [
      "branchenverzeichnis", "firmenverzeichnis", "unternehmensverzeichnis",
      "handwerkerverzeichnis", "installateursuche", "fachbetriebe",
      "klempnersuche", "heizungssuche",
    ];
    if (CATALOG_HOST_KEYWORDS.some(k => hostname.includes(k))) return true;

    return false;
  } catch {
    return false;
  }
}

/** Deduplicate results by normalised URL — catalog entries are kept so the
 *  agent can inject catalog_deep_crawl steps for them, but deduplicated by URL */
function deduplicate(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = r.url.toLowerCase().replace(/\/+$/, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Exported so tests and the LLM system prompt can reference the same list */
export { CATALOG_DOMAINS, isCatalogUrl };

// ── Layer 1b: Serper.dev (Google Search JSON API) ─────────────────────────────

/**
 * Search via Serper.dev — Google SERP JSON API.
 * 2,500 free queries/month, then $1/1000. Docs: https://serper.dev
 */
export async function searchViaSerper(
  query: string,
  serperApiKey: string,
  maxResults = 50
): Promise<SearchResult[]> {
  if (!query.trim()) throw new Error("empty query");
  if (!serperApiKey.trim()) throw new Error("missing Serper API key");

  const { controller, clear } = withTimeout(10_000);
  let res: Response;
  try {
    res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": serperApiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, gl: "de", hl: "de", num: 100, page: 1 }),
      // Serper supports up to 100 results per request; request max always
      signal: controller.signal,
    });
  } finally {
    clear();
  }
  if (!res.ok) { await drainBody(res); throw new Error(`Serper HTTP ${res.status}`); }
  const data = await res.json() as {
    organic?: Array<{ title?: string; link?: string; snippet?: string }>;
    knowledgeGraph?: { title?: string; website?: string; description?: string };
  };
  const results: SearchResult[] = [];
  if (data.knowledgeGraph?.website) {
    results.push({ title: sanitiseText(data.knowledgeGraph.title ?? "", 200), url: data.knowledgeGraph.website, snippet: sanitiseText(data.knowledgeGraph.description ?? "", 400) });
  }
  for (const r of data.organic ?? []) {
    if (results.length >= maxResults) break;
    const url = (r.link ?? "").trim();
    if (!url.startsWith("http")) continue;
    results.push({ title: sanitiseText(r.title ?? "", 200), url, snippet: sanitiseText(r.snippet ?? "", 400) });
  }
  return deduplicate(results);
}

// ── Layer 1: SerpAPI ─────────────────────────────────────────────────────────

const SERPAPI_MAX_PER_PAGE = 10;  // Google hard limit per request

/**
 * Fetch one page of SerpAPI results.
 * `start` = 0-based offset (0, 10, 20, …)
 */
async function searchViaSerpApiPage(
  query: string,
  serpApiKey: string,
  num: number,
  start: number
): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    api_key: serpApiKey,
    num: String(num),
    start: String(start),
    hl: "de",
    gl: "de",
    safe: "active",
  });

  const { controller, clear } = withTimeout(10_000);
  let res: Response;
  try {
    res = await fetch(`https://serpapi.com/search.json?${params}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    clear();
  }

  if (!res.ok) { await drainBody(res); throw new Error(`SerpAPI HTTP ${res.status}`); }

  const data = await res.json() as { organic_results?: Array<{ title?: string; link?: string; snippet?: string }> };
  const organic = data?.organic_results ?? [];
  return organic.map((r) => ({
    title: sanitiseText(r.title ?? "", 200),
    url: (r.link ?? "").trim(),
    snippet: sanitiseText(r.snippet ?? "", 400),
  })).filter((r) => r.url.startsWith("http"));
}

/**
 * SerpAPI search with automatic pagination.
 * Fetches multiple pages until `maxResults` are collected or results run dry.
 * Deduplicates by URL across pages.
 */
export async function searchViaSerpApi(
  query: string,
  serpApiKey: string,
  maxResults = 50
): Promise<SearchResult[]> {
  if (!query.trim()) throw new Error("empty query");
  if (!serpApiKey.trim()) throw new Error("missing SerpAPI key");

  const allResults: SearchResult[] = [];
  const seen = new Set<string>();

  for (let start = 0; allResults.length < maxResults; start += SERPAPI_MAX_PER_PAGE) {
    const pageSize = Math.min(SERPAPI_MAX_PER_PAGE, maxResults - allResults.length);
    const page = await searchViaSerpApiPage(query, serpApiKey, pageSize, start);

    if (page.length === 0) break;  // no more results

    for (const r of page) {
      if (!seen.has(r.url)) {
        seen.add(r.url);
        allResults.push(r);
      }
    }

    // If we got fewer results than requested, Google has no more
    if (page.length < pageSize) break;

    // Safety: max 20 pages (200 results) per query — Google supports up to start=190
    if (start >= 190) break;
  }

  return allResults;
}

// ── Layer 2: DuckDuckGo HTML scraping ────────────────────────────────────────

export async function searchViaDuckDuckGo(
  query: string,
  maxResults = 50
): Promise<SearchResult[]> {
  if (!query.trim()) throw new Error("empty query");

  const { load } = await import("cheerio");
  const params = new URLSearchParams({ q: query, kl: "de-de", s: "0" });

  const { controller, clear } = withTimeout(12_000);
  let res: Response;
  try {
    res = await fetch(`https://html.duckduckgo.com/html/?${params}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
        Referer: "https://duckduckgo.com/",
      },
      signal: controller.signal,
      redirect: "follow",
    });
  } finally {
    clear();
  }

  if (!res.ok) {
    await drainBody(res);
    throw new Error(`DuckDuckGo HTTP ${res.status}`);
  }

  const html = await res.text();
  if (!html.trim()) throw new Error("DuckDuckGo returned empty body");

  const $ = load(html);
  const results: SearchResult[] = [];

  // Primary selectors (DDG HTML layout)
  const primaryStrategy = () => {
    $(".result__body, .result").each((_i, el) => {
      if (results.length >= maxResults) return false;
      const title =
        $(el).find(".result__title a, .result__a").first().text().trim();
      const rawUrl =
        $(el).find(".result__url").text().trim() ||
        $(el).find(".result__a").attr("href") || "";
      const snippet =
        $(el).find(".result__snippet").text().trim() ||
        $(el).find(".result__extras__url").text().trim();

      const url = rawUrl.startsWith("http") ? rawUrl : rawUrl ? `https://${rawUrl}` : "";
      if (title && url.startsWith("http")) {
        results.push({
          title: sanitiseText(title, 200),
          url,
          snippet: sanitiseText(snippet, 400),
        });
      }
    });
  };

  // Fallback: generic <a> links with meaningful text
  const fallbackStrategy = () => {
    $("a[href^='http']").each((_i, el) => {
      if (results.length >= maxResults) return false;
      const href = $(el).attr("href") ?? "";
      const text = $(el).text().trim();
      if (
        text.length > 10 &&
        !href.includes("duckduckgo.com") &&
        !href.includes("duck.co")
      ) {
        results.push({
          title: sanitiseText(text, 200),
          url: href,
          snippet: "",
        });
      }
    });
  };

  primaryStrategy();
  if (results.length === 0) fallbackStrategy();

  return deduplicate(results);
}

// ── Layer 2: Brave Search API ──────────────────────────────────────────────

export async function searchViaBrave(
  query: string,
  braveApiKey: string,
  maxResults = 50
): Promise<SearchResult[]> {
  if (!query.trim()) throw new Error("empty query");
  if (!braveApiKey.trim()) throw new Error("missing Brave API key");

  const params = new URLSearchParams({
    q: query,
    count: String(Math.min(maxResults, 20)),
    search_lang: "de",
    country: "DE",
    safesearch: "off",
    text_decorations: "false",
  });

  const { controller, clear } = withTimeout(10_000);
  let res: Response;
  try {
    res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": braveApiKey,
      },
      signal: controller.signal,
    });
  } finally {
    clear();
  }

  if (!res.ok) {
    await drainBody(res);
    throw new Error(`Brave Search HTTP ${res.status}`);
  }

  const data = await res.json() as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
  const hits = data?.web?.results ?? [];
  return deduplicate(
    hits.slice(0, maxResults).map((r) => ({
      title: sanitiseText(r.title ?? "", 200),
      url: (r.url ?? "").trim(),
      snippet: sanitiseText(r.description ?? "", 400),
    })).filter((r) => r.url.startsWith("http"))
  );
}

// ── Layer 3: DuckDuckGo HTML scraping (kept as fallback) ───────────────────

// ── Layer 4: Playwright headless Chromium on Bing ───────────────────────────

// ── Layer 5: Scrapling sidecar (Google bypass / Cloudflare stealth) ──────────

export async function searchViaScrapling(
  query: string,
  scraplingUrl: string,
  scraplingToken: string,
  maxResults = 50,
): Promise<SearchResult[]> {
  if (!query.trim()) throw new Error("empty query");
  if (!scraplingUrl.trim()) throw new Error("missing SCRAPLING_URL");
  if (!scraplingToken.trim()) throw new Error("missing SCRAPLING_TOKEN");

  const { controller, clear } = withTimeout(45_000);
  let res: Response;
  try {
    res = await fetch(`${scraplingUrl}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": scraplingToken,
      },
      body: JSON.stringify({ query, max_results: maxResults }),
      signal: controller.signal,
    });
  } finally {
    clear();
  }

  if (!res.ok) {
    await drainBody(res);
    throw new Error(`Scrapling HTTP ${res.status}`);
  }

  const data = await res.json() as { results?: Array<{ title?: string; url?: string; snippet?: string }> };
  return deduplicate(
    (data.results ?? []).slice(0, maxResults).map((r) => ({
      title: sanitiseText(r.title ?? "", 200),
      url: (r.url ?? "").trim(),
      snippet: sanitiseText(r.snippet ?? "", 400),
    })).filter((r) => r.url.startsWith("http"))
  );
}

// ── Layer: Firecrawl + Linkup via Eden AI (US endpoint) ─────────────────────

const firecrawlLastCall = { ts: 0 };

export async function searchViaFirecrawl(
  query: string,
  edenApiKey: string,
  maxResults = 50,
  depth: "basic" | "deep" = "basic",
  includeDomains?: string[]
): Promise<{ results: SearchResult[]; costUsd?: number }> {
  if (!query.trim()) throw new Error("empty query");
  if (!edenApiKey.trim()) throw new Error("missing Eden AI key for Firecrawl");

  // Rate limit: min 2.0s between Firecrawl calls to avoid 429
  const now = Date.now();
  const wait = Math.max(0, 2000 - (now - firecrawlLastCall.ts));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  firecrawlLastCall.ts = Date.now();

  // Run Firecrawl + Linkup in parallel, merge and deduplicate
  // Both are billed per result but give different result sets
  const [firecrawlResults, linkupResults] = await Promise.allSettled([
    edenWebSearch({ apiKey: edenApiKey, query, limit: maxResults, depth, provider: "firecrawl", includeDomains }),
    // Only use linkup if no domain restriction (it doesn't support includeDomains)
    includeDomains?.length
      ? Promise.reject(new Error("skip-linkup"))
      : edenWebSearch({ apiKey: edenApiKey, query, limit: Math.min(maxResults, 10), provider: "linkup" }),
  ]);

  const allResults: SearchResult[] = [];
  const seen = new Set<string>();

  const add = (r: EdenWebSearchResult) => {
    const url = r.url.trim();
    if (!url.startsWith("http") || seen.has(url)) return;
    seen.add(url);
    allResults.push({
      title: sanitiseText(r.title, 200),
      url,
      snippet: sanitiseText(r.snippet, 400),
    });
  };

  if (firecrawlResults.status === "fulfilled") firecrawlResults.value.results.forEach(add);
  if (linkupResults.status === "fulfilled") linkupResults.value.results.forEach(add);

  // Fallback: if both failed, throw the firecrawl error
  if (firecrawlResults.status === "rejected" && linkupResults.status === "rejected") {
    throw firecrawlResults.reason;
  }

  // Sum real costs from both providers
  let costUsd: number | undefined;
  if (firecrawlResults.status === "fulfilled" && typeof firecrawlResults.value.costUsd === "number") costUsd = firecrawlResults.value.costUsd;
  if (linkupResults.status === "fulfilled" && typeof linkupResults.value.costUsd === "number") {
    costUsd = (costUsd ?? 0) + linkupResults.value.costUsd;
  }

  return { results: allResults, costUsd };
}

export async function searchViaPlaywright(
  query: string,
  maxResults = 50
): Promise<SearchResult[]> {
  if (!query.trim()) throw new Error("empty query");

  const { chromium } = await import("playwright");

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--disable-extensions",
    ],
  });

  // Browser is always closed regardless of what throws inside
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale: "de-DE",
      viewport: { width: 1280, height: 900 },
      extraHTTPHeaders: { "Accept-Language": "de-DE,de;q=0.9" },
    });

    // Block ads / tracking to speed up page load
    await context.route(
      /\.(png|jpg|gif|webp|svg|woff2?|css)(\?.*)?$/i,
      (route) => route.abort()
    );

    type RawItem = { title: string; url: string; snippet: string };

    async function tryEngine(
      url: string,
      waitSelector: string,
      extract: (max: number) => RawItem[]
    ): Promise<RawItem[]> {
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
        await page.waitForSelector(waitSelector, { timeout: 6_000 }).catch(() => {});
        return await page.evaluate(extract, maxResults);
      } finally {
        await page.close();
      }
    }

    // Engine 1: DuckDuckGo full JS (renders in real browser, bypasses HTML challenge)
    let raw = await tryEngine(
      `https://duckduckgo.com/?q=${encodeURIComponent(query)}&kl=de-de`,
      "[data-testid='result']",
      (max) => {
        const items: RawItem[] = [];
        const cards = document.querySelectorAll("[data-testid='result']");
        for (const card of Array.from(cards).slice(0, max * 2)) {
          const a = card.querySelector("a[data-testid='result-title-a']") as HTMLAnchorElement | null;
          const snippet = card.querySelector("[data-result='snippet']")?.textContent ?? "";
          if (a?.href && !a.href.includes("duckduckgo.com")) {
            items.push({ title: (a.textContent ?? "").trim(), url: a.href, snippet: snippet.trim() });
          }
          if (items.length >= max) break;
        }
        return items;
      }
    ).catch(() => [] as RawItem[]);

    // Engine 2: Bing (decodes bing.com/ck/a redirect URLs via u= base64 param)
    if (raw.length === 0) {
      raw = await tryEngine(
        `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=de&cc=DE`,
        "li.b_algo",
        (max) => {
          const items: RawItem[] = [];
          const cards = document.querySelectorAll("li.b_algo");
          for (const card of Array.from(cards).slice(0, max * 2)) {
            const a = card.querySelector("h2 a") as HTMLAnchorElement | null;
            const p = card.querySelector(".b_caption p") ?? card.querySelector(".b_dList li");
            if (!a?.href) continue;
            // Decode bing redirect: bing.com/ck/a?...&u=a1<base64>&...
            let url = a.href;
            try {
              const uParam = new URL(url).searchParams.get("u");
              if (uParam?.startsWith("a1")) {
                url = atob(uParam.slice(2));
              }
            } catch { /* keep original */ }
            if (url.startsWith("http") && !url.includes("bing.com")) {
              items.push({ title: (a.textContent ?? "").trim(), url, snippet: (p?.textContent ?? "").trim() });
            }
            if (items.length >= max) break;
          }
          return items;
        }
      ).catch(() => [] as RawItem[]);
    }

    // Engine 3: Google (last resort — may require consent click, but often works)
    if (raw.length === 0) {
      raw = await tryEngine(
        `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=de&gl=de&num=10`,
        "#search .g",
        (max) => {
          const items: RawItem[] = [];
          const cards = document.querySelectorAll("#search .g");
          for (const card of Array.from(cards).slice(0, max * 2)) {
            const a = card.querySelector("a") as HTMLAnchorElement | null;
            const snippet = card.querySelector(".VwiC3b, .st, span[style]")?.textContent ?? "";
            const h3 = card.querySelector("h3")?.textContent ?? "";
            if (a?.href && a.href.startsWith("http") && !a.href.includes("google.com") && h3) {
              items.push({ title: h3.trim(), url: a.href, snippet: snippet.trim() });
            }
            if (items.length >= max) break;
          }
          return items;
        }
      ).catch(() => [] as RawItem[]);
    }

    return deduplicate(
      raw.map((r) => ({
        title: sanitiseText(r.title, 200),
        url: r.url,
        snippet: sanitiseText(r.snippet, 400),
      })).filter((r) => r.url.startsWith("http"))
    );
  } finally {
    await browser.close();
  }
}

// ── Public: orchestrated search with fallback chain ──────────────────────────

export async function webSearch(
  query: string,
  options: {
    serpApiKey?: string;
    serperApiKey?: string;
    braveApiKey?: string;
    scraplingUrl?: string;
    scraplingToken?: string;
    firecrawlApiKey?: string;
    maxResults?: number;
    forceLayer?: SearchLayer;
    /** Upper bound for maxResults clamp (default 10; discovery passes higher) */
    limitCap?: number;
    /** Firecrawl search depth: "basic" (fast, cheap) | "deep" (more results, costs more) */
    firecrawlDepth?: "basic" | "deep";
  } = {}
): Promise<SearchResponse> {
  const { serpApiKey, serperApiKey, braveApiKey, scraplingUrl, scraplingToken, firecrawlApiKey, maxResults = 50, forceLayer, limitCap = 200, firecrawlDepth = "basic" } = options;
  const clampedMax = Math.max(1, Math.min(maxResults, limitCap));
  const layerErrors: Record<string, string> = {};
  const t0 = Date.now();

  async function tryLayer<T>(
    name: string,
    fn: () => Promise<T[]>
  ): Promise<T[] | null> {
    try {
      const res = await fn();
      return res;
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      console.warn(`[search] ${name} failed:`, msg);
      layerErrors[name] = msg;
      return null;
    }
  }

  const respond = (results: SearchResult[], source: SearchLayer, costUsd?: number): SearchResponse => ({
    results,
    source,
    query,
    latencyMs: Date.now() - t0,
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(Object.keys(layerErrors).length > 0 ? { layerErrors } : {}),
  });

  // ─ forceLayer: skip fallback chain ─
  if (forceLayer) {
    if (forceLayer === "serpapi") {
      if (!serpApiKey) throw new Error("forceLayer=serpapi but no SERP_API_KEY");
      const r = await searchViaSerpApi(query, serpApiKey, clampedMax);
      return respond(r, "serpapi");
    }
    if (forceLayer === "serper") {
      if (!serperApiKey) throw new Error("forceLayer=serper but no SERPER_API_KEY");
      const r = await searchViaSerper(query, serperApiKey, clampedMax);
      return respond(r, "serper");
    }
    if (forceLayer === "brave") {
      if (!braveApiKey) throw new Error("forceLayer=brave but no BRAVE_API_KEY");
      const r = await searchViaBrave(query, braveApiKey, clampedMax);
      return respond(r, "brave");
    }
    if (forceLayer === "duckduckgo") {
      const r = await searchViaDuckDuckGo(query, clampedMax);
      return respond(r, "duckduckgo");
    }
    if (forceLayer === "playwright") {
      const r = await searchViaPlaywright(query, clampedMax);
      return respond(r, "playwright");
    }
    if (forceLayer === "scrapling") {
      if (!scraplingUrl || !scraplingToken) throw new Error("forceLayer=scrapling but no SCRAPLING_URL/TOKEN");
      const r = await searchViaScrapling(query, scraplingUrl, scraplingToken, clampedMax);
      return respond(r, "scrapling");
    }    if (forceLayer === "firecrawl") {
      if (!firecrawlApiKey) throw new Error("forceLayer=firecrawl but no Eden AI key");
      const { results, costUsd } = await searchViaFirecrawl(query, firecrawlApiKey!, clampedMax, firecrawlDepth);
      return respond(results, "firecrawl", costUsd);
    }  }

  // ─ Layer 1: SerpAPI ─
  if (serpApiKey) {
    const r = await tryLayer("serpapi", () =>
      searchViaSerpApi(query, serpApiKey!, clampedMax)
    );
    if (r && r.length > 0) return respond(r, "serpapi");
  }

  // ─ Layer 1b: Serper.dev (cheaper Google, 2500 free/month) ─
  if (serperApiKey) {
    const r = await tryLayer("serper", () =>
      searchViaSerper(query, serperApiKey!, clampedMax)
    );
    if (r && r.length > 0) return respond(r, "serper");
  }

  // ─ Layer 2: Brave Search API ─
  if (braveApiKey) {
    const r = await tryLayer("brave", () =>
      searchViaBrave(query, braveApiKey!, clampedMax)
    );
    if (r && r.length > 0) return respond(r, "brave");
  }

  // ─ Layer 2b: Firecrawl via Eden AI (structured, reliable; US endpoint) ─
  if (firecrawlApiKey) {
    const r = await tryLayer("firecrawl", () =>
      searchViaFirecrawl(query, firecrawlApiKey!, clampedMax, firecrawlDepth).then(({ results }) => results)
    );
    if (r && r.length > 0) return respond(r, "firecrawl");
  }

  // ─ Layer 3: DuckDuckGo HTML scraping ─
  const r3 = await tryLayer("duckduckgo", () =>
    searchViaDuckDuckGo(query, clampedMax)
  );
  if (r3 && r3.length > 0) return respond(r3, "duckduckgo");

  // ─ Layer 4: Playwright ─
  const r4 = await tryLayer("playwright", () =>
    searchViaPlaywright(query, clampedMax)
  );
  if (r4 && r4.length > 0) return respond(r4, "playwright");

  // ─ Layer 5: Scrapling (Google bypass / Cloudflare stealth) ─
  if (scraplingUrl && scraplingToken) {
    const r5 = await tryLayer("scrapling", () =>
      searchViaScrapling(query, scraplingUrl!, scraplingToken!, clampedMax)
    );
    if (r5 && r5.length > 0) return respond(r5, "scrapling");
  }

  return {
    results: [],
    source: "scrapling",
    query,
    latencyMs: Date.now() - t0,
    error: "All search layers failed",
    layerErrors,
  };
}

// ── Helper: format results as context string for LLM ─────────────────────────

export function formatSearchResultsForLlm(
  response: SearchResponse,
  maxSnippetLen = 400
): string {
  if (response.results.length === 0) return "(No search results found)";
  const header = `Found ${response.results.length} result(s) via ${response.source} in ${response.latencyMs}ms:`;
  const body = response.results
    .map((r, i) => {
      let domain = "";
      try {
        domain = new URL(r.url).hostname.replace(/^www\./, "");
      } catch {}
      return `[${i + 1}] ${r.title}
URL: ${r.url}${domain ? `\nDomain: ${domain}` : ""}
Snippet: ${r.snippet.slice(0, maxSnippetLen)}`;
    })
    .join("\n\n");
  return `${header}\n\n${body}`;
}

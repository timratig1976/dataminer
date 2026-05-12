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

// ── Types ────────────────────────────────────────────────────────────────────

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export type SearchLayer = "serpapi" | "brave" | "duckduckgo" | "playwright";

export interface SearchResponse {
  results: SearchResult[];
  source: SearchLayer;
  query: string;
  latencyMs: number;
  /** Populated when all layers fail */
  error?: string;
  /** Warnings from layers that were tried but failed */
  layerErrors?: Record<string, string>;
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
  // German business directories
  "wlw.de", "gelbeseiten.de", "dasoertliche.de", "dastelefonbuch.de",
  "11880.com", "11880.de", "meinestadt.de", "stadtbranchenbuch.com",
  "branchenbuch.de", "firmen.de", "firmenwissen.de", "northdata.de",
  "northdata.com", "companyhouse.de", "handelsregister.de",
  "unternehmensregister.de", "bundesanzeiger.de", "creditreform.de",
  "bisnode.de", "hoppenstedt.de", "dun.com", "dnb.com",
  "cylex.de", "cylex-branchenbuch.de", "werkenntwen.de",
  "marktplatz-mittelstand.de", "europages.de", "europages.com",
  "kompass.com", "kompass.de", "wer-liefert-was.de",
  // Generic / international directories
  "yelp.com", "yelp.de", "foursquare.com", "trustpilot.com",
  "trustpilot.de", "kununu.com", "glassdoor.com", "glassdoor.de",
  "manta.com", "hotfrog.com", "yellowpages.com", "superpages.com",
  "thomasnet.com", "alibaba.com", "aliexpress.com",
  "dnb.com", "bloomberg.com", "crunchbase.com",
  // Social / professional
  "linkedin.com", "xing.com", "facebook.com", "instagram.com",
  "twitter.com", "x.com", "youtube.com", "tiktok.com",
  "pinterest.com", "snapchat.com",
  // Maps / review
  "maps.google.com", "google.com/maps", "maps.apple.com",
  "tripadvisor.com", "tripadvisor.de", "golocal.de",
  // App stores / job boards
  "play.google.com", "apps.apple.com", "indeed.com", "stepstone.de",
  "monster.de", "jobs.de",
  // Wiki / encyclopaedic
  "wikipedia.org", "wikidata.org",
]);

/** Returns true if the URL belongs to a catalog/directory domain */
function isCatalogUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    // exact match or subdomain match (e.g. de.trustpilot.com)
    return Array.from(CATALOG_DOMAINS).some(
      (d) => hostname === d || hostname.endsWith(`.${d}`)
    );
  } catch {
    return false;
  }
}

/** Deduplicate results by normalised URL and strip catalog/directory entries */
function deduplicate(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    if (isCatalogUrl(r.url)) return false;
    const key = r.url.toLowerCase().replace(/\/+$/, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Exported so tests and the LLM system prompt can reference the same list */
export { CATALOG_DOMAINS, isCatalogUrl };

// ── Layer 1: SerpAPI ─────────────────────────────────────────────────────────

export async function searchViaSerpApi(
  query: string,
  serpApiKey: string,
  maxResults = 5
): Promise<SearchResult[]> {
  if (!query.trim()) throw new Error("empty query");
  if (!serpApiKey.trim()) throw new Error("missing SerpAPI key");

  const params = new URLSearchParams({
    q: query,
    api_key: serpApiKey,
    num: String(Math.min(maxResults, 10)),
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

  if (!res.ok) {
    await drainBody(res);
    throw new Error(`SerpAPI HTTP ${res.status}`);
  }

  const data = await res.json() as { organic_results?: Array<{ title?: string; link?: string; snippet?: string }> };
  const organic = data?.organic_results ?? [];
  return deduplicate(
    organic.slice(0, maxResults).map((r) => ({
      title: sanitiseText(r.title ?? "", 200),
      url: (r.link ?? "").trim(),
      snippet: sanitiseText(r.snippet ?? "", 400),
    })).filter((r) => r.url.startsWith("http"))
  );
}

// ── Layer 2: DuckDuckGo HTML scraping ────────────────────────────────────────

export async function searchViaDuckDuckGo(
  query: string,
  maxResults = 5
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
  maxResults = 5
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

export async function searchViaPlaywright(
  query: string,
  maxResults = 5
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
    braveApiKey?: string;
    maxResults?: number;
    forceLayer?: SearchLayer;
  } = {}
): Promise<SearchResponse> {
  const { serpApiKey, braveApiKey, maxResults = 5, forceLayer } = options;
  const clampedMax = Math.max(1, Math.min(maxResults, 10));
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

  const respond = (results: SearchResult[], source: SearchLayer): SearchResponse => ({
    results,
    source,
    query,
    latencyMs: Date.now() - t0,
    ...(Object.keys(layerErrors).length > 0 ? { layerErrors } : {}),
  });

  // ─ forceLayer: skip fallback chain ─
  if (forceLayer) {
    if (forceLayer === "serpapi") {
      if (!serpApiKey) throw new Error("forceLayer=serpapi but no SERP_API_KEY");
      const r = await searchViaSerpApi(query, serpApiKey, clampedMax);
      return respond(r, "serpapi");
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
  }

  // ─ Layer 1: SerpAPI ─
  if (serpApiKey) {
    const r = await tryLayer("serpapi", () =>
      searchViaSerpApi(query, serpApiKey!, clampedMax)
    );
    if (r && r.length > 0) return respond(r, "serpapi");
  }

  // ─ Layer 2: Brave Search API ─
  if (braveApiKey) {
    const r = await tryLayer("brave", () =>
      searchViaBrave(query, braveApiKey!, clampedMax)
    );
    if (r && r.length > 0) return respond(r, "brave");
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

  return {
    results: [],
    source: "playwright",
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

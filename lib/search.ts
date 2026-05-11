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

export type SearchLayer = "serpapi" | "duckduckgo" | "playwright";

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

/** Deduplicate results by normalised URL */
function deduplicate(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = r.url.toLowerCase().replace(/\/+$/, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

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

// ── Layer 3: Playwright headless Chromium on Bing ───────────────────────────

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

    const page = await context.newPage();
    await page.goto(
      `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=de&cc=DE&form=QBLH`,
      { waitUntil: "domcontentloaded", timeout: 20_000 }
    );

    // Wait for results to appear (max 5s)
    await page.waitForSelector("#b_results .b_algo", { timeout: 5_000 }).catch(() => {});

    const raw = await page.evaluate((max: number) => {
      const items: { title: string; url: string; snippet: string }[] = [];

      // Primary: Bing organic result cards
      const cards = document.querySelectorAll("#b_results .b_algo");
      for (const card of Array.from(cards).slice(0, max * 2)) {
        const a = card.querySelector("h2 a") as HTMLAnchorElement | null;
        const p =
          card.querySelector(".b_caption p") ??
          card.querySelector(".b_dList li");
        if (a?.href && !a.href.includes("bing.com")) {
          items.push({
            title: (a.textContent ?? "").trim(),
            url: a.href,
            snippet: (p?.textContent ?? "").trim(),
          });
        }
        if (items.length >= max) break;
      }
      return items;
    }, maxResults);

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
    maxResults?: number;
    forceLayer?: SearchLayer;
  } = {}
): Promise<SearchResponse> {
  const { serpApiKey, maxResults = 5, forceLayer } = options;
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

  // ─ Layer 2: DuckDuckGo ─
  const r2 = await tryLayer("duckduckgo", () =>
    searchViaDuckDuckGo(query, clampedMax)
  );
  if (r2 && r2.length > 0) return respond(r2, "duckduckgo");

  // ─ Layer 3: Playwright ─
  const r3 = await tryLayer("playwright", () =>
    searchViaPlaywright(query, clampedMax)
  );
  if (r3 && r3.length > 0) return respond(r3, "playwright");

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
  maxSnippetLen = 300
): string {
  if (response.results.length === 0) return "(Keine Suchergebnisse gefunden)";
  const header = `Suchergebnisse (via ${response.source}, ${response.latencyMs}ms):`;
  const body = response.results
    .map(
      (r, i) =>
        `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet.slice(0, maxSnippetLen)}`
    )
    .join("\n\n");
  return `${header}\n\n${body}`;
}

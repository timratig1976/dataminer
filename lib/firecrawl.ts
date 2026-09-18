/**
 * lib/firecrawl.ts
 * Direct Firecrawl API integration (v1/scrape and v1/search).
 *
 * Saves massive costs compared to routing through Eden AI ($0.0038/token).
 * Direct Firecrawl plans bill per request/credit flat (approx $0.001 - $0.005 / URL).
 */

export interface FirecrawlScrapeResult {
  markdown: string;
  title?: string;
  costUsd?: number;
}

export interface FirecrawlSearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

function getFirecrawlBaseUrl(): string {
  return (process.env.FIRECRAWL_API_URL || "https://api.firecrawl.dev/v1").replace(/\/+$/, "");
}

/**
 * Scrape a single URL directly with the Firecrawl API.
 * Returns clean markdown content and page title.
 */
export async function directFirecrawlScrape(params: {
  apiKey: string;
  url: string;
  signal?: AbortSignal;
}): Promise<FirecrawlScrapeResult> {
  const { apiKey, url, signal } = params;
  if (!apiKey?.trim()) throw new Error("Missing Firecrawl API key");
  if (!url?.trim()) throw new Error("Missing URL for scrape");

  const endpoint = `${getFirecrawlBaseUrl()}/scrape`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
    }),
    signal,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const errorMsg = json.error || json.message || `Firecrawl HTTP ${res.status}`;
    throw new Error(`Direct Firecrawl scrape failed: ${errorMsg}`);
  }

  const data = json.data ?? json;
  const markdown = String(data.markdown ?? data.content ?? "").trim();
  const title = String(data.metadata?.title ?? data.title ?? "").trim();

  // Direct Firecrawl cost: 1 credit = 0,004 € (~$0.00435 USD)
  return {
    markdown,
    title: title || undefined,
    costUsd: 0.00435,
  };
}

/**
 * Search the web directly with the Firecrawl API.
 */
export async function directFirecrawlSearch(params: {
  apiKey: string;
  query: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<{ results: FirecrawlSearchResultItem[]; costUsd?: number }> {
  const { apiKey, query, limit = 5, signal } = params;
  if (!apiKey?.trim()) throw new Error("Missing Firecrawl API key");
  if (!query?.trim()) throw new Error("Missing query for Firecrawl search");

  const endpoint = `${getFirecrawlBaseUrl()}/search`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      limit,
    }),
    signal,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const errorMsg = json.error || json.message || `Firecrawl HTTP ${res.status}`;
    throw new Error(`Direct Firecrawl search failed: ${errorMsg}`);
  }

  const rawList: any[] = Array.isArray(json.data)
    ? json.data
    : Array.isArray(json.data?.data)
    ? json.data.data
    : [];

  const results: FirecrawlSearchResultItem[] = rawList
    .map((r) => ({
      title: String(r?.title ?? "").slice(0, 200),
      url: String(r?.url ?? "").trim(),
      snippet: String(r?.description ?? r?.markdown ?? r?.content ?? "").slice(0, 400),
    }))
    .filter((r) => r.url.startsWith("http"));

  return {
    results,
    costUsd: 0.00435,
  };
}

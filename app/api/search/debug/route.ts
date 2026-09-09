import { NextRequest, NextResponse } from "next/server";

/**
 * GET/POST /api/search/debug
 *
 * Runs each search provider INDIVIDUALLY (no fallback chain) and returns the
 * RAW provider payload so you can see exactly what e.g. Firecrawl/Eden or
 * SerpApi returned. Used by the /scrapling-test page ("Provider-Logs").
 *
 * Response: { query, logs: ProviderLog[] }
 * ProviderLog: { provider, ok, latencyMs, httpStatus?, requestUrl?, raw?, error? }
 *
 * `raw` is the provider's untouched JSON (or HTML head for scraping layers),
 * truncated to ~20k chars for the UI. API keys are redacted from requestUrl.
 */

export interface ProviderLog {
  provider: string;
  ok: boolean;
  latencyMs: number;
  httpStatus?: number;
  requestUrl?: string;
  raw?: unknown;
  error?: string;
}

const RAW_MAX_CHARS = 20_000;

function redact(url: string): string {
  return url
    .replace(/(api_key=)[^&]+/i, "$1***")
    .replace(/(X-Subscription-Token:\s*)\S+/i, "$1***");
}

function truncate(value: unknown): unknown {
  try {
    const s = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    if (s.length <= RAW_MAX_CHARS) return typeof value === "string" ? value : JSON.parse(s);
    return `${s.slice(0, RAW_MAX_CHARS)}\n… [truncated at ${RAW_MAX_CHARS} chars]`;
  } catch {
    return String(value).slice(0, RAW_MAX_CHARS);
  }
}

async function timeIt<T>(fn: () => Promise<T>): Promise<{ value: T; latencyMs: number }> {
  const t0 = Date.now();
  const value = await fn();
  return { value, latencyMs: Date.now() - t0 };
}

async function probeSerpApi(query: string, key: string): Promise<ProviderLog> {
  const params = new URLSearchParams({ q: query, api_key: key, num: "10", hl: "de", gl: "de", safe: "active" });
  const url = `https://serpapi.com/search.json?${params}`;
  try {
    const { value, latencyMs } = await timeIt(async () => {
      const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
      const json = await res.json().catch(() => null);
      return { res, json };
    });
    return {
      provider: "serpapi",
      ok: value.res.ok,
      latencyMs,
      httpStatus: value.res.status,
      requestUrl: redact(url),
      raw: value.res.ok ? truncate(value.json) : truncate(value.json ?? (await value.res.text().catch(() => ""))),
      ...(value.res.ok ? {} : { error: `HTTP ${value.res.status}` }),
    };
  } catch (e) {
    return { provider: "serpapi", ok: false, latencyMs: 0, requestUrl: redact(url), error: (e as Error).message };
  }
}

async function probeBrave(query: string, key: string): Promise<ProviderLog> {
  const params = new URLSearchParams({ q: query, count: "10", search_lang: "de", country: "DE", safesearch: "off" });
  const url = `https://api.search.brave.com/res/v1/web/search?${params}`;
  try {
    const { value, latencyMs } = await timeIt(async () => {
      const res = await fetch(url, {
        headers: { Accept: "application/json", "X-Subscription-Token": key },
        signal: AbortSignal.timeout(15_000),
      });
      const json = await res.json().catch(() => null);
      return { res, json };
    });
    return {
      provider: "brave",
      ok: value.res.ok,
      latencyMs,
      httpStatus: value.res.status,
      requestUrl: redact(url),
      raw: truncate(value.json ?? ""),
      ...(value.res.ok ? {} : { error: `HTTP ${value.res.status}` }),
    };
  } catch (e) {
    return { provider: "brave", ok: false, latencyMs: 0, requestUrl: redact(url), error: (e as Error).message };
  }
}

async function probeFirecrawl(query: string, edenKey: string): Promise<ProviderLog> {
  const url = "https://api.edenai.run/v3/universal-ai";
  const body = { model: "web/search/firecrawl", input: { query, limit: 10 }, show_original_response: false };
  try {
    const { value, latencyMs } = await timeIt(async () => {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${edenKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      const json = await res.json().catch(() => null);
      return { res, json };
    });
    return {
      provider: "firecrawl (Eden AI, US)",
      ok: value.res.ok && value.json?.status === "success",
      latencyMs,
      httpStatus: value.res.status,
      requestUrl: url,
      raw: truncate(value.json ?? ""),
      ...(value.res.ok && value.json?.status === "success"
        ? {}
        : { error: value.json?.error?.message ?? value.json?.status ?? `HTTP ${value.res.status}` }),
    };
  } catch (e) {
    return { provider: "firecrawl (Eden AI, US)", ok: false, latencyMs: 0, requestUrl: url, error: (e as Error).message };
  }
}

async function probeDuckDuckGo(query: string): Promise<ProviderLog> {
  const params = new URLSearchParams({ q: query, kl: "de-de", s: "0" });
  const url = `https://html.duckduckgo.com/html/?${params}`;
  try {
    const { value, latencyMs } = await timeIt(async () => {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "text/html",
        },
        signal: AbortSignal.timeout(15_000),
      });
      const text = await res.text().catch(() => "");
      return { res, text };
    });
    const resultCount = (value.text.match(/class="result__body"/g) ?? []).length;
    return {
      provider: "duckduckgo (HTML)",
      ok: value.res.ok && resultCount > 0,
      latencyMs,
      httpStatus: value.res.status,
      requestUrl: url,
      raw: truncate(`<!-- ${resultCount} result bodies found -->\n${value.text.slice(0, RAW_MAX_CHARS)}`),
      ...(value.res.ok && resultCount > 0 ? {} : { error: value.res.ok ? "0 results parsed" : `HTTP ${value.res.status}` }),
    };
  } catch (e) {
    return { provider: "duckduckgo (HTML)", ok: false, latencyMs: 0, requestUrl: url, error: (e as Error).message };
  }
}

async function probeScrapling(query: string): Promise<ProviderLog> {
  const scraplingUrl = process.env.SCRAPLING_URL?.trim() || "http://127.0.0.1:8001";
  const token = process.env.SCRAPLING_TOKEN?.trim() || "dev-local-token";
  const url = `${scraplingUrl}/search`;
  try {
    const { value, latencyMs } = await timeIt(async () => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-token": token },
        body: JSON.stringify({ query, max_results: 10 }),
        signal: AbortSignal.timeout(90_000),
      });
      const json = await res.json().catch(() => null);
      return { res, json };
    });
    const count = Array.isArray(value.json?.results) ? value.json.results.length : 0;
    return {
      provider: "scrapling (sidecar)",
      ok: value.res.ok && count > 0,
      latencyMs,
      httpStatus: value.res.status,
      requestUrl: url,
      raw: truncate(value.json ?? ""),
      ...(value.res.ok && count > 0 ? {} : { error: value.res.ok ? "0 results parsed" : `HTTP ${value.res.status}` }),
    };
  } catch (e) {
    return { provider: "scrapling (sidecar)", ok: false, latencyMs: 0, requestUrl: url, error: (e as Error).message };
  }
}

async function probeMapsSerpApi(query: string, key: string): Promise<ProviderLog> {
  const params = new URLSearchParams({ engine: "google_maps", q: query, hl: "de", type: "search", num: "10", api_key: key });
  const url = `https://serpapi.com/search.json?${params}`;
  try {
    const { value, latencyMs } = await timeIt(async () => {
      const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
      const json = await res.json().catch(() => null);
      return { res, json };
    });
    const count = Array.isArray(value.json?.local_results) ? value.json.local_results.length : 0;
    return {
      provider: "google-maps (SerpApi)",
      ok: value.res.ok && count > 0,
      latencyMs,
      httpStatus: value.res.status,
      requestUrl: redact(url),
      raw: value.res.ok ? truncate(value.json) : truncate(value.json ?? ""),
      ...(value.res.ok && count > 0 ? {} : { error: value.res.ok ? "0 local_results" : `HTTP ${value.res.status}` }),
    };
  } catch (e) {
    return { provider: "google-maps (SerpApi)", ok: false, latencyMs: 0, requestUrl: redact(url), error: (e as Error).message };
  }
}

async function handle(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  let query = sp.get("q") ?? "";
  let only: string[] = [];

  if (req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as { query?: string; providers?: string[] };
    query = body.query ?? query;
    only = Array.isArray(body.providers) ? body.providers : [];
  } else {
    only = sp.getAll("provider");
  }

  if (!query.trim()) {
    return NextResponse.json({ error: "query (q) required" }, { status: 400 });
  }

  const serpKey = process.env.SERP_API_KEY?.trim() || "";
  const braveKey = process.env.BRAVE_API_KEY?.trim() || "";
  const edenKey = process.env.EDEN_API_KEY?.trim() || "";

  const probes: Array<[string, () => Promise<ProviderLog>]> = [
    ["serpapi", () => (serpKey ? probeSerpApi(query, serpKey) : Promise.resolve({ provider: "serpapi", ok: false, latencyMs: 0, error: "SERP_API_KEY not set" }))],
    ["brave", () => (braveKey ? probeBrave(query, braveKey) : Promise.resolve({ provider: "brave", ok: false, latencyMs: 0, error: "BRAVE_API_KEY not set" }))],
    ["firecrawl", () => (edenKey ? probeFirecrawl(query, edenKey) : Promise.resolve({ provider: "firecrawl (Eden AI, US)", ok: false, latencyMs: 0, error: "EDEN_API_KEY not set" }))],
    ["duckduckgo", () => probeDuckDuckGo(query)],
    ["scrapling", () => probeScrapling(query)],
    ["maps", () => (serpKey ? probeMapsSerpApi(query, serpKey) : Promise.resolve({ provider: "google-maps (SerpApi)", ok: false, latencyMs: 0, error: "SERP_API_KEY not set" }))],
  ];

  const selected = only.length > 0 ? probes.filter(([name]) => only.includes(name)) : probes;

  // Run in parallel — these are independent probes
  const logs = await Promise.all(selected.map(([, fn]) => fn()));

  return NextResponse.json({ query, logs });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}

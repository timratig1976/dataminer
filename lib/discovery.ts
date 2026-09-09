/**
 * lib/discovery.ts
 * Lead discovery engine — "load many results first, enrich later".
 *
 * Builds on the existing search layers (lib/search.ts) but raises the result
 * cap (default 10 → up to 100) and normalises hits into seed rows that can be
 * appended to a case's data table.
 *
 * Also supports the "extend existing data" flow: build query templates from
 * existing rows, search each, and filter out companies already present
 * (dedupe by normalised domain).
 */

import psl from "psl";
import { webSearch, formatSearchResultsForLlm, isCatalogUrl, type SearchLayer, type SearchResult } from "./search";

// ── Types ────────────────────────────────────────────────────────────────────

export type DiscoverySource =
  | "auto"
  | "firecrawl"
  | "serpapi"
  | "brave"
  | "duckduckgo"
  | "scrapling"
  | "maps-serpapi"
  | "maps-scrapling";

export const MAX_DISCOVERY_LIMIT = 100;

export interface DiscoveryOptions {
  source?: DiscoverySource;
  limit?: number;
  /** URLs/domains already present in the case — hits are flagged as duplicates */
  excludeDomains?: string[];
  serpApiKey?: string;
  braveApiKey?: string;
  scraplingUrl?: string;
  scraplingToken?: string;
  edenApiKey?: string;
  signal?: AbortSignal;
}

export interface DiscoveryHit {
  title: string;
  url: string;
  /** Normalised registrable domain (e.g. example.com), empty when unparseable */
  domain: string;
  snippet: string;
  /** Hit belongs to a known catalog/directory domain */
  isCatalog: boolean;
  /** Domain already exists in the case */
  isDuplicate: boolean;
  searchQuery: string;
  searchSource: string;
}

export interface DiscoverySearchResponse {
  hits: DiscoveryHit[];
  source: string;
  query: string;
  latencyMs: number;
  error?: string;
}

// ── Domain helpers ───────────────────────────────────────────────────────────

/**
 * Normalise a URL to its registrable domain using the Public Suffix List.
 * Returns "" when the URL is unparseable or an IP address.
 */
export function normalizeDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":")) return "";
    const parsed = psl.parse(hostname);
    if (parsed.error) {
      // heuristic fallback: last two labels
      const parts = hostname.split(".");
      return parts.length >= 2 ? parts.slice(-2).join(".") : hostname;
    }
    return parsed.domain ?? hostname;
  } catch {
    return "";
  }
}

/** Dedupe a hit list by normalised domain, keeping the first occurrence. */
export function dedupeHits(hits: DiscoveryHit[]): DiscoveryHit[] {
  const seen = new Set<string>();
  return hits.filter((h) => {
    if (!h.domain) return true; // keep domain-less hits (rare) — user decides
    if (seen.has(h.domain)) return false;
    seen.add(h.domain);
    return true;
  });
}

// ── Web search discovery ─────────────────────────────────────────────────────

function sourceToLayer(source: DiscoverySource): SearchLayer | undefined {
  switch (source) {
    case "firecrawl": return "firecrawl";
    case "serpapi": return "serpapi";
    case "brave": return "brave";
    case "duckduckgo": return "duckduckgo";
    case "scrapling": return "scrapling";
    default: return undefined; // auto → full fallback chain
  }
}

/**
 * Run a discovery search. Maps sources are handled in lib/maps.ts and merged
 * by the API route; this function covers the web-search based sources.
 */
export async function discoverySearch(
  query: string,
  options: DiscoveryOptions = {}
): Promise<DiscoverySearchResponse> {
  const {
    source = "auto",
    limit = 30,
    excludeDomains = [],
    serpApiKey,
    braveApiKey,
    scraplingUrl,
    scraplingToken,
    edenApiKey,
  } = options;

  if (!query.trim()) throw new Error("empty query");

  const clampedLimit = Math.max(1, Math.min(limit, MAX_DISCOVERY_LIMIT));
  const excludeSet = new Set(excludeDomains.map((d) => d.toLowerCase().trim()).filter(Boolean));

  const layersToTry: (SearchLayer | undefined)[] =
    source === "auto"
      ? [undefined] // let webSearch's fallback chain decide
      : [sourceToLayer(source)];

  const t0 = Date.now();
  let lastError = "";

  for (const layer of layersToTry) {
    // For large limits, scrape-style layers return at most their native cap
    // (serpapi 10/page, brave 20). Firecrawl handles higher limits natively.
    try {
      const resp = await webSearch(query, {
        serpApiKey,
        braveApiKey,
        scraplingUrl,
        scraplingToken,
        firecrawlApiKey: edenApiKey,
        maxResults: clampedLimit,
        forceLayer: layer,
        limitCap: MAX_DISCOVERY_LIMIT,
      });

      if (resp.results.length > 0) {
        return {
          hits: toHits(resp.results, query, resp.source, excludeSet),
          source: resp.source,
          query: resp.query,
          latencyMs: Date.now() - t0,
        };
      }
      lastError = resp.error ?? "no results";
    } catch (e) {
      lastError = (e as Error).message;
    }
  }

  return {
    hits: [],
    source: source,
    query,
    latencyMs: Date.now() - t0,
    error: `Discovery search failed: ${lastError}`,
  };
}

function toHits(
  results: SearchResult[],
  query: string,
  source: string,
  excludeSet: Set<string>
): DiscoveryHit[] {
  const hits = results.map((r) => {
    const domain = normalizeDomain(r.url);
    return {
      title: r.title,
      url: r.url,
      domain,
      snippet: r.snippet,
      isCatalog: isCatalogUrl(r.url),
      isDuplicate: !!domain && excludeSet.has(domain),
      searchQuery: query,
      searchSource: source,
    };
  });
  return dedupeHits(hits);
}

// ── Extend mode: query templates from existing rows ─────────────────────────

export interface TemplateRow {
  data: Record<string, string | null>;
}

/**
 * Render a query template against row data ({column} placeholders) and
 * collect unique, non-empty queries across all rows.
 */
export function buildQueriesFromRows(
  rows: TemplateRow[],
  template: string,
  maxQueries = 50
): string[] {
  const seen = new Set<string>();
  const queries: string[] = [];

  for (const row of rows) {
    let unresolved = false;
    const q = template.replace(/\{([^}]+)\}/g, (_, key) => {
      const idx = key.indexOf("|");
      const fields = idx >= 0
        ? [key.slice(0, idx).trim(), ...key.slice(idx + 1).split("|").map((s: string) => s.trim())]
        : [key.trim()];
      for (const f of fields) {
        const v = row.data[f];
        if (v != null && String(v).trim() !== "" && String(v).trim() !== "(not provided)") {
          return String(v).trim();
        }
      }
      unresolved = true;
      return "";
    }).replace(/\s{2,}/g, " ").trim();

    // skip queries with unresolved (empty) placeholders
    if (unresolved || !q || q.includes("{")) continue;
    if (seen.has(q.toLowerCase())) continue;
    seen.add(q.toLowerCase());
    queries.push(q);
    if (queries.length >= maxQueries) break;
  }

  return queries;
}

// ── Seed rows for case import ────────────────────────────────────────────────

export interface SeedRowData extends Record<string, string> {
  company_name: string;
  source_url: string;
  source_title: string;
  source_snippet: string;
  source_domain: string;
  search_query: string;
  search_source: string;
}

/** Convert an accepted discovery hit into a seed row for a case table. */
export function hitToSeedRow(hit: DiscoveryHit): SeedRowData {
  return {
    company_name: hit.title || "",
    source_url: hit.url,
    source_title: hit.title,
    source_snippet: hit.snippet,
    source_domain: hit.domain,
    search_query: hit.searchQuery,
    search_source: hit.searchSource,
  };
}

/** Context string of discovery hits for an LLM batch call (name extraction). */
export function formatHitsForLlm(hits: DiscoveryHit[]): string {
  return hits
    .map((h, i) => `[${i + 1}] ${h.title}\nURL: ${h.url}\nSnippet: ${h.snippet}`)
    .join("\n\n");
}

export { formatSearchResultsForLlm };

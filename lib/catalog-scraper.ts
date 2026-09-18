/**
 * lib/catalog-scraper.ts
 * Multi-page catalog scraping for structured data extraction.
 *
 * Strategy:
 *  1. Firecrawl (via Eden US) scrapes each page → Markdown
 *  2. LLM (gpt-4o-mini) extracts entries + detects next-page URL
 *  3. Pagination is followed until maxPages limit or no next URL
 *  4. Results are deduplicated by domain before return
 *
 * Token-efficiency measures:
 *  - Markdown is stripped of nav/footer boilerplate before LLM call
 *  - LLM system prompt is fixed (not repeated per row) → system cache
 *  - Entries extracted as compact JSON, no prose
 *  - Regex pagination detection first — LLM only as fallback
 */

import { edenScrapeUrl, edenChatCompletion } from "./edenai";
import { normalizeDomain } from "./discovery";
import { webSearch } from "./search";
import { getCachedScrape, setCachedScrape } from "./db";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CatalogEntry {
  company_name: string | null;
  domain: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  zip: string | null;
  description: string | null;
  source_url: string;
  [key: string]: string | null;
}

export interface CatalogScrapeOptions {
  url: string;
  extractionPrompt?: string;   // what kind of entries to extract (e.g. "Heizungsunternehmen")
  followPagination?: boolean;  // default true
  maxPages?: number;           // default 10
  edenApiKey: string;
  model?: string;              // default "openai/gpt-4o-mini"
  signal?: AbortSignal;
  onProgress?: (page: number, entriesFound: number) => void;
  /** If true, fire a web search for entries without a domain to find their website */
  resolveMissingDomains?: boolean;
  /** Search API keys for domain resolution (at least one needed) */
  serperApiKey?: string;
  serpApiKey?: string;
  braveApiKey?: string;
}

export interface CatalogScrapeResult {
  entries: CatalogEntry[];
  pagesScraped: number;
  errors: string[];
  tokenEstimate: number;
}

// ── Markdown cleaning ─────────────────────────────────────────────────────────

const NAV_PATTERNS = [
  /^(navigation|nav|menu|header|footer|breadcrumb|cookie|impressum|datenschutz).*/gim,
  /\[.*?\]\(javascript:.*?\)/g,    // JS links
  /!\[.*?\]\(.*?\)/g,              // images
  /^(\s*[-*]\s*){5,}/gm,           // long bullet lists (likely menu)
];

const MAX_MARKDOWN_CHARS = 12_000; // ~3k tokens — enough for a full catalog page

function cleanMarkdown(md: string): string {
  let s = md;
  for (const p of NAV_PATTERNS) {
    s = s.replace(p, "");
  }
  // Collapse excessive blank lines
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  // Truncate if still too long
  if (s.length > MAX_MARKDOWN_CHARS) {
    s = s.slice(0, MAX_MARKDOWN_CHARS) + "\n[truncated]";
  }
  return s;
}

// ── Pagination detection ──────────────────────────────────────────────────────

const PAGINATION_PATTERNS = [
  /[?&]page=(\d+)/i,
  /[?&]seite=(\d+)/i,
  /[?&]p=(\d+)/i,
  /[?&]start=(\d+)/i,
  /\/seite\/(\d+)/i,
  /\/page\/(\d+)/i,
  /\/(\d+)\/?$/,
];

function incrementPageUrl(url: string): string | null {
  for (const pattern of PAGINATION_PATTERNS) {
    const match = url.match(pattern);
    if (match) {
      const currentPage = parseInt(match[1], 10);
      return url.replace(match[0], match[0].replace(String(currentPage), String(currentPage + 1)));
    }
  }
  return null;
}

function buildPage2Url(url: string): string | null {
  if (url.includes("?")) return url + "&page=2";
  return url + "?page=2";
}

// ── LLM extraction ────────────────────────────────────────────────────────────

const EXTRACTION_SYSTEM = `Du bist ein präziser Daten-Extraktions-Agent für Firmenverzeichnisse.
Extrahiere alle Firmen-/Unternehmenseinträge aus dem gegebenen Markdown-Text.

Antworte NUR mit minimalem JSON (keine Erklärungen, kein Markdown):
{
  "entries": [
    {"company_name":"...","domain":"...","phone":"...","email":"...","address":"...","city":"...","zip":"...","description":"..."}
  ],
  "next_page_url": "..." | null
}

Regeln:
- Fehlende Felder: null (nicht weglassen)
- domain: NUR die eigene Website-Domain der Firma (ohne http/https), z.B. "muster-gmbh.de"
  WICHTIG: Setze domain=null wenn die Firma keine eigene Website hat — NIEMALS die Katalog/Verzeichnis-Domain selbst (z.B. dastelefonbuch.de, gelbeseiten.de, my-hammer.de etc.)
- Keine doppelten Einträge
- next_page_url: URL zur nächsten Seite wenn erkennbar, sonst null`;

interface LlmExtractionResult {
  entries: Partial<CatalogEntry>[];
  next_page_url: string | null;
}

async function extractFromMarkdown(
  markdown: string,
  sourceUrl: string,
  extractionPrompt: string,
  edenApiKey: string,
  model: string
): Promise<LlmExtractionResult> {
  const userContent = extractionPrompt
    ? `Gesucht: ${extractionPrompt}\n\nQuelle: ${sourceUrl}\n\n---\n${markdown}`
    : `Quelle: ${sourceUrl}\n\n---\n${markdown}`;

  const resp = await edenChatCompletion({
    apiKey: edenApiKey,
    region: "us",  // Catalog extraction uses gpt-4o-mini — US endpoint only
    model,
    system: EXTRACTION_SYSTEM,
    prompt: userContent,
    maxTokens: 2000,
    temperature: 0,
  });

  const raw = resp.raw?.trim() ?? "";

  // Strip potential markdown code fences
  const jsonStr = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();

  try {
    const parsed = JSON.parse(jsonStr) as LlmExtractionResult;
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      next_page_url: parsed.next_page_url ?? null,
    };
  } catch {
    return { entries: [], next_page_url: null };
  }
}

// ── Main scraper ──────────────────────────────────────────────────────────────

// ── Domain resolution via web search ────────────────────────────────────────

// Known directory/catalog domains — never return these as a firm's own website
const CATALOG_DOMAINS_BLOCKLIST = new Set([
  "dastelefonbuch.de", "gelbeseiten.de", "my-hammer.de", "houzz.de",
  "dasoertliche.de", "immobilienscout24.de", "trustlocal.de", "yelp.de",
  "yelp.com", "yellowpages.com", "tripadvisor.de", "tripadvisor.com",
  "google.com", "google.de", "bing.com", "facebook.com", "instagram.com",
  "linkedin.com", "xing.com", "kununu.com", "wlw.de", "europages.de",
  "11880.com", "cylex.de", "meinbezirk.at", "herold.at",
  "stadtbranchenbuch.com", "branchenbuch.de", "firmendb.de",
]);

async function resolveDomainViaSearch(
  companyName: string,
  city: string | null,
  options: Pick<CatalogScrapeOptions, "serperApiKey" | "serpApiKey" | "braveApiKey">
): Promise<string | null> {
  const query = city ? `"${companyName}" ${city}` : `"${companyName}" Website`;
  try {
    const resp = await webSearch(query, {
      serperApiKey: options.serperApiKey,
      serpApiKey: options.serpApiKey,
      braveApiKey: options.braveApiKey,
      maxResults: 3,
      limitCap: 5,
    });
    for (const r of resp.results) {
      try {
        const hostname = new URL(r.url).hostname.replace(/^www\./, "").toLowerCase();
        if (!CATALOG_DOMAINS_BLOCKLIST.has(hostname) && hostname.includes(".")) {
          return hostname;
        }
      } catch { /* skip invalid URLs */ }
    }
  } catch { /* ignore search errors */ }
  return null;
}

export async function scrapeCatalog(options: CatalogScrapeOptions): Promise<CatalogScrapeResult> {
  const {
    url,
    extractionPrompt = "",
    followPagination = true,
    maxPages = 10,
    edenApiKey,
    model = "openai/gpt-4o-mini",
    signal,
    onProgress,
    resolveMissingDomains = false,
    serperApiKey,
    serpApiKey,
    braveApiKey,
  } = options;

  const allEntries: CatalogEntry[] = [];
  const errors: string[] = [];
  const visitedUrls = new Set<string>();
  let tokenEstimate = 0;
  let currentUrl: string | null = url;
  let page = 0;

  while (currentUrl && page < maxPages) {
    if (signal?.aborted) break;
    if (visitedUrls.has(currentUrl)) break;
    visitedUrls.add(currentUrl);
    page++;

    // 1. Scrape page
    let markdown = "";
    try {
      const cached = await getCachedScrape(currentUrl).catch(() => null);
      if (cached?.markdown) {
        markdown = cached.markdown;
      } else {
        const scrapeResult = await edenScrapeUrl({ apiKey: edenApiKey, url: currentUrl });
        markdown = scrapeResult.markdown;
        if (markdown.trim()) await setCachedScrape(currentUrl, markdown, scrapeResult.title).catch(() => {});
      }
    } catch (e) {
      errors.push(`Page ${page} scrape error: ${(e as Error).message}`);
      break;
    }

    if (!markdown.trim()) {
      errors.push(`Page ${page}: empty content`);
      break;
    }

    // 2. Clean markdown (reduce tokens)
    const cleaned = cleanMarkdown(markdown);
    tokenEstimate += Math.ceil(cleaned.length / 4); // rough estimate

    // 3. LLM extraction
    let extracted: LlmExtractionResult;
    try {
      extracted = await extractFromMarkdown(cleaned, currentUrl, extractionPrompt, edenApiKey, model);
    } catch (e) {
      errors.push(`Page ${page} extraction error: ${(e as Error).message}`);
      break;
    }

    // 4. Normalize & collect entries
    for (const entry of extracted.entries) {
      const normalized: CatalogEntry = {
        company_name: entry.company_name ?? null,
        domain: normalizeDomainFromEntry(entry.domain),
        phone: entry.phone ?? null,
        email: entry.email ?? null,
        address: entry.address ?? null,
        city: entry.city ?? null,
        zip: entry.zip ?? null,
        description: entry.description ?? null,
        source_url: currentUrl,
      };
      allEntries.push(normalized);
    }

    onProgress?.(page, allEntries.length);

    if (!followPagination) break;

    // 5. Determine next page URL
    // Priority: LLM-detected → regex increment → stop
    let nextUrl: string | null = null;

    if (extracted.next_page_url && !visitedUrls.has(extracted.next_page_url)) {
      nextUrl = makeAbsolute(extracted.next_page_url, currentUrl);
    } else {
      const incremented = incrementPageUrl(currentUrl);
      if (incremented && !visitedUrls.has(incremented)) {
        nextUrl = incremented;
      } else if (page === 1) {
        // Try appending ?page=2 as last resort
        const p2 = buildPage2Url(currentUrl);
        if (p2 && !visitedUrls.has(p2)) nextUrl = p2;
      }
    }

    currentUrl = nextUrl;
  }

  // Deduplicate by domain
  const seenDomains = new Set<string>();
  const deduped = allEntries.filter((e) => {
    if (!e.domain) return true;
    if (seenDomains.has(e.domain)) return false;
    seenDomains.add(e.domain);
    return true;
  });

  // Optional: resolve missing domains via web search
  if (resolveMissingDomains) {
    const missingIdxs = deduped
      .map((e, i) => (!e.domain && e.company_name ? i : -1))
      .filter(i => i >= 0);

    // Run in small batches (3 parallel) to avoid rate limits
    const BATCH = 3;
    for (let b = 0; b < missingIdxs.length; b += BATCH) {
      if (signal?.aborted) break;
      const batch = missingIdxs.slice(b, b + BATCH);
      await Promise.all(batch.map(async (idx) => {
        const entry = deduped[idx];
        const domain = await resolveDomainViaSearch(
          entry.company_name!,
          entry.city,
          { serperApiKey, serpApiKey, braveApiKey }
        );
        if (domain) deduped[idx] = { ...entry, domain };
      }));
    }
  }

  return {
    entries: deduped,
    pagesScraped: page,
    errors,
    tokenEstimate,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeDomainFromEntry(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const withScheme = raw.includes("://") ? raw : `https://${raw}`;
  const domain = normalizeDomain(withScheme);
  return domain || raw.toLowerCase().replace(/^www\./, "").trim() || null;
}

function makeAbsolute(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

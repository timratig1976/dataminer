/**
 * lib/batch-enrich.ts
 * Batch enrichment: scrape a company's domain + optional contact search → 1 LLM call → all fields at once.
 *
 * Strategy (per row):
 *   1. Determine domain from row data (source_domain / domain / source_url)
 *   2. Scrape the homepage via Firecrawl → Markdown (cached)
 *   3. If batchSearchContacts: search "{company} site:linkedin.com OR Geschäftsführer"
 *   4. One LLM call with all context → JSON with all requested fields
 *   5. Write all fields to the row in one go
 *
 * This replaces 6–8 separate column-by-column LLM calls with 1-2 calls total.
 * Token saving: ~70–80% vs. running each column individually.
 */

import { edenChatCompletion, edenScrapeUrl } from "./edenai";
import { webSearch } from "./search";
import { getCachedScrape, setCachedScrape } from "./db";

/** Strip surrogate pairs and other invalid UTF-16 sequences that Eden AI rejects. */
function sanitizeForLlm(text: string): string {
  return text.replace(/[\uD800-\uDFFF]/g, "\uFFFD").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");
}

/**
 * Remove cookie banners, DSGVO notices, navigation noise and image spam from scraped Markdown.
 * Strips common patterns before sending to LLM.
 */
function filterScrapedContent(markdown: string): string {
  const lines = markdown.split("\n");
  const filtered = lines.filter(line => {
    const l = line.trim().toLowerCase();
    if (l.length === 0) return true;

    // ── Cookie / DSGVO / Datenschutz ──
    if (l.includes("einwilligungsoptionen") || l.includes("einwilligungsoption")) return false;
    if (l.includes("einstellung zum datenschutz")) return false;
    if (l.includes("cookie") && (l.includes("akzeptier") || l.includes("zustimm") || l.includes("einwillig") || l.includes("ablehnen") || l.includes("einstellung") || l.includes("banner") || l.includes("hinweis"))) return false;
    if (l.includes("datenschutz") && (l.includes("hinweis") || l.includes("einwillig") || l.includes("richtlinie") || l.includes("erkl"))) return false;
    if (l.includes("dsgvo") || l.includes("gdpr") || l.includes("ccpa")) return false;
    if (l.includes("wir verwenden cookies") || l.includes("diese website verwendet") || l.includes("durch die nutzung dieser")) return false;
    if (l.includes("zum inhalt springen") || l.includes("skip to content") || l.includes("zum hauptinhalt")) return false;
    if (l.includes("zu einwilligungs") || l.includes("zu cookie")) return false;

    // ── Image markdown lines — strip completely (![alt](url)) ──
    if (/^!\[.*?\]\(https?:\/\//.test(line.trim())) return false;

    // ── Pure nav/menu lines (short link-only lines) ──
    if (/^\[.{1,40}\]\(https?:\/\//.test(line.trim()) && line.trim().length < 80) return false;

    // ── WordPress upload paths in links (image links wrapped in anchor) ──
    if (l.includes("wp-content/uploads") || l.includes("wp-content/themes")) return false;

    // ── "Weiterlesen"-style CTA links ──
    if (/^\[weiterlesen|^\[mehr erfahren|^\[read more|^\[jetzt/i.test(line.trim())) return false;

    return true;
  });
// Collapse >2 consecutive empty lines to 1
  return filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Check if the scraped markdown already contains essential company contact details
 * (at least email and either phone or address/management).
 */
export function hasSufficientContactInfo(markdown: string): boolean {
  if (!markdown || markdown.length < 50) return false;
  // Look for email pattern (excluding image extensions)
  const hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?!\.(?:png|jpg|jpeg|webp|gif|svg))/i.test(markdown);
  // Look for phone or postal address or leadership hints
  const hasPhone = /(?:tel|telefon|fon|phone|mobil)?[:\s/]*(\+?[0-9][0-9\s/()\-]{6,}[0-9])/i.test(markdown);
  const hasLeadership = /(?:geschäftsführer|inhaber|vorstand|vertreten durch|ansprechpartner)/i.test(markdown);

  return hasEmail && (hasPhone || hasLeadership);
}

/**
 * Extract a targeted Impressum / Contact link from the homepage Markdown or raw text.
 * Returns an absolute URL or undefined if none found.
 */
export function findImpressumLink(rawMarkdown: string, baseUrl: string): string | undefined {
  if (!rawMarkdown) return undefined;
  
  // Look for Markdown links [Anchor](url) or HTML <a href="...">
  const mdLinkRegex = /\[([^\]]*?(?:impressum|imprint|kontakt|contact|über\s*uns|ueber\s*uns|legal)[^\]]*?)\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/gi;
  const htmlLinkRegex = /<a[^>]+href=["'](https?:\/\/[^"'>]+|\/[^"'>]+)["'][^>]*>(?:(?!<\/a>).)*(?:impressum|imprint|kontakt|contact|über\s*uns|ueber\s*uns|legal)/gi;
  
  let match: RegExpExecArray | null;
  const candidates: { url: string; score: number }[] = [];

  while ((match = mdLinkRegex.exec(rawMarkdown)) !== null) {
    const text = match[1].toLowerCase();
    const href = match[2];
    let score = 1;
    if (text.includes("impressum") || text.includes("imprint")) score = 10;
    else if (text.includes("kontakt")) score = 5;
    candidates.push({ url: href, score });
  }

  while ((match = htmlLinkRegex.exec(rawMarkdown)) !== null) {
    const href = match[1];
    candidates.push({ url: href, score: 8 });
  }

  // Also check standard URL patterns in markdown links like [Rechtliches](/impressum)
  const hrefOnlyRegex = /\[[^\]]+\]\(((?:https?:\/\/[^\s)]+)?\/(?:impressum|imprint|kontakt|legal)(?:\.html|\/)?)\)/gi;
  while ((match = hrefOnlyRegex.exec(rawMarkdown)) !== null) {
    candidates.push({ url: match[1], score: 9 });
  }

  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0].url;
  try {
    const resolved = new URL(best, baseUrl);
    // Ensure it belongs to the same domain (not an external social link)
    const baseHost = new URL(baseUrl).hostname.replace(/^www\./, "");
    if (!resolved.hostname.replace(/^www\./, "").includes(baseHost)) return undefined;
    return resolved.toString();
  } catch {
    return undefined;
  }
}

// ── Output field definitions ──────────────────────────────────────────────────

export const BATCH_FIELDS = [
  "company_name",
  "domain",
  "phone",
  "company_email",
  "address",
  "city",
  "zip",
  "industry",
  "description",
  "employees",
  "founded",
  "first_name",
  "last_name",
  "position",
  "linkedin",
] as const;

export type BatchField = (typeof BATCH_FIELDS)[number];

export const BATCH_FIELD_LABELS: Record<BatchField, string> = {
  company_name: "Firmenname",
  domain: "Domain/Website",
  phone: "Telefon (primäre Kontaktnummer)",
  company_email: "E-Mail (Firmen-Hauptadresse, z.B. info@, kontakt@)",
  address: "Adresse (Straße + Hausnummer)",
  city: "Stadt",
  zip: "PLZ",
  industry: "Branche",
  description: "Kurzbeschreibung",
  employees: "Mitarbeiterzahl",
  founded: "Gründungsjahr",
  first_name: "Vorname Ansprechpartner/GF",
  last_name: "Nachname Ansprechpartner/GF",
  position: "Position Ansprechpartner/GF",
  linkedin: "LinkedIn-Profil URL",
};

// ── System prompt (fixed, cached by LLM provider) ─────────────────────────────

/** Exported so the UI can show the default prompt and offer a "reset to default". */
export function buildSystemPrompt(requestedFields: string[]): string {
  const fieldList = requestedFields
    .map((f) => `  "${f}": "${BATCH_FIELD_LABELS[f as BatchField] ?? f}"`)
    .join(",\n");

  return `Du bist ein präziser Daten-Extraktions-Agent für Unternehmensprofile.
Analysiere die gegebenen Quellen (Website-Inhalt, Impressum, Suchergebnisse) und extrahiere strukturierte Unternehmensdaten.

WICHTIG — Ignoriere folgende Inhalte vollständig (nicht extrahieren, nicht zitieren):
- Cookie-Banner, DSGVO/Datenschutz-Hinweise, Cookie-Einwilligungs-Texte
- Navigation, Footer-Links, Breadcrumbs, Menüpunkte
- Werbetexte, Slider-Teaser, Social-Media-Buttons
- AGBs, Widerrufsbelehrungen, Haftungsausschlüsse

Antworte NUR mit JSON (kein Markdown, keine Erklärungen):
{
${fieldList}
}

Regeln:
- Fehlende Felder: null (NICHT weglassen, NICHT raten)
- domain: nur Basis-Domain ohne http/https/www (z.B. "example.de")
- phone: primäre Kontaktnummer im internationalen Format (z.B. "+49 381 454000"); bei mehreren Nummern: Zentrale/Hauptnummer bevorzugen
- company_email: generische Firmen-Hauptadresse (info@, kontakt@, mail@, office@, hallo@) — KEINE persönlichen Emails; aus Impressum oder Kontaktseite
- address: Straße und Hausnummer (ohne PLZ/Stadt)
- city: Ortsname
- zip: Postleitzahl (5-stellig)
- industry: präzise Branchenbezeichnung (z.B. "Heizungs-, Sanitär- und Klimatechnik", "Steuerberatung", "Softwareentwicklung")
- description: 1-2 prägnante Sätze was das Unternehmen macht (aus Über-uns oder Homepage, kein Marketing-Bla)
- employees: Zahl oder Größenklasse (z.B. "12", "50-200") — nur wenn eindeutig angegeben
- founded: Gründungsjahr (4-stellig) — nur wenn eindeutig angegeben
- first_name / last_name / position: Geschäftsführer oder Inhaber — nur wenn klar benannt im Impressum; kein Raten`;
}

// ── Main enrichment function ──────────────────────────────────────────────────

export interface BatchEnrichOptions {
  edenApiKey: string;
  firecrawlApiKey?: string;
  model?: string;
  serpApiKey?: string;
  braveApiKey?: string;
  edenRegion?: "eu" | "us";
  requestedFields?: string[];
  searchContacts?: boolean;
  cachedScrape?: string;  // pre-fetched markdown (from scrape_cache)
  /** Custom system prompt override (from column.prompt). If empty, uses default. */
  customSystemPrompt?: string;
  signal?: AbortSignal;
}

export interface BatchEnrichResult {
  fields: Record<string, string | null>;
  scrapeMarkdown?: string;
  impressumMarkdown?: string;
  searchSnippets?: string;
  debugPrompt?: string;
  debugRawResponse?: string;
  sourcesUsed?: string[];
  tokensUsed?: number;
  costUsd?: number;
  error?: string;
  scrapeError?: string;
  searchError?: string;
}

export async function batchEnrichRow(
  rowData: Record<string, string | null | undefined>,
  options: BatchEnrichOptions
): Promise<BatchEnrichResult> {
  const {
    edenApiKey,
    firecrawlApiKey,
    model = "openai/gpt-4o-mini",
    serpApiKey,
    braveApiKey,
    requestedFields = [...BATCH_FIELDS],
    searchContacts = false,  // default off — batch_contact column handles contacts separately
    cachedScrape,
    customSystemPrompt,
    signal,
  } = options;

  // 1. Resolve domain
  const domain = resolveDomain(rowData);
  const companyName = rowData["company_name"] ?? rowData["source_title"] ?? "";

  if (!domain && !companyName) {
    return { fields: {}, error: "No domain or company name available" };
  }

  const contextParts: string[] = [];
  const sourcesUsed: string[] = [];
  let scrapeMarkdown: string | undefined;
  let searchSnippets: string | undefined;
  let impressumMarkdown: string | undefined;
  let scrapeError: string | undefined;
  let searchError: string | undefined;
  let rowScrapeCostUsd = 0;
  let rowSearchCostUsd = 0;

  // 2. Scrape homepage + impressum/kontakt page for company email
  // IMPORTANT: skip scrape if domain is a non-company URL (Google Maps, social media, etc.)
  const isRealDomain = domain && !NON_COMPANY_DOMAINS.has(domain) && !isNonCompanyUrl(domain);
  if (isRealDomain) {
    const base = domain.startsWith("http") ? domain : `https://${domain}`;
    let rawHomepageMarkdown = cachedScrape;

    // Check PostgreSQL scrape_cache if cachedScrape wasn't passed directly
    if (!rawHomepageMarkdown) {
      const dbCached = await getCachedScrape(base).catch(() => null);
      if (dbCached?.markdown) {
        rawHomepageMarkdown = dbCached.markdown;
      }
    }

    if (rawHomepageMarkdown) {
      scrapeMarkdown = filterScrapedContent(rawHomepageMarkdown);
    } else {
      try {
        const result = await edenScrapeUrl({
          apiKey: edenApiKey,
          directFirecrawlApiKey: firecrawlApiKey,
          url: base,
          signal,
        });
        rawHomepageMarkdown = result.markdown ?? "";
        scrapeMarkdown = filterScrapedContent(rawHomepageMarkdown.slice(0, 6000));
        rowScrapeCostUsd += (result.costUsd ?? 0.00435);
        // Persist homepage in scrape_cache
        if (rawHomepageMarkdown.trim()) {
          await setCachedScrape(base, rawHomepageMarkdown, result.title).catch(() => {});
        }
      } catch (e) {
        scrapeError = (e as Error).message;
      }
    }

    if (scrapeMarkdown?.trim()) {
      contextParts.push(`## Homepage (${domain})\n${scrapeMarkdown}`);
      sourcesUsed.push("scrape");
    }

    // ── Targeted Impressum Scrape (P0 IP Protection & Cost Optimization) ──
    // 1. Only scrape if essential contact data is NOT already present on homepage.
    // 2. Scrape AT MOST 1 targeted page (parsed from homepage links or standard fallback).
    const alreadyHasInfo = rawHomepageMarkdown ? hasSufficientContactInfo(rawHomepageMarkdown) : false;

    if (!alreadyHasInfo) {
      const targetedLink = rawHomepageMarkdown ? findImpressumLink(rawHomepageMarkdown, base) : undefined;
      const impressumUrl = targetedLink || `${base}/impressum`;

      try {
        // Check cache first for the impressum URL
        let rawImpressum = await getCachedScrape(impressumUrl).catch(() => null);
        if (!rawImpressum?.markdown) {
          const result = await edenScrapeUrl({
            apiKey: edenApiKey,
            directFirecrawlApiKey: firecrawlApiKey,
            url: impressumUrl,
            signal,
          });
          if (result.markdown && result.markdown.length > 100) {
            rawImpressum = { markdown: result.markdown, title: result.title };
            rowScrapeCostUsd += (result.costUsd ?? 0.00435);
            await setCachedScrape(impressumUrl, result.markdown, result.title).catch(() => {});
          }
        }

        if (rawImpressum?.markdown && rawImpressum.markdown.length > 100) {
          impressumMarkdown = filterScrapedContent(rawImpressum.markdown.slice(0, 3500));
          contextParts.push(`## Impressum/Kontakt (${impressumUrl})\n${impressumMarkdown}`);
          sourcesUsed.push(`impressum:${impressumUrl}`);
        }
      } catch {
        // Targeted impressum failed, don't burn more calls
      }
    }
  }

  // 3. Contact search (if requested and contacts are in requestedFields)
  const wantsContacts = requestedFields.some(f => ["first_name", "last_name", "position", "linkedin"].includes(f));
  if (searchContacts && wantsContacts && companyName) {
    try {
      const contactQuery = `"${companyName}" Geschäftsführer OR Inhaber OR CEO site:linkedin.com OR Impressum`;
      const resp = await webSearch(contactQuery, {
        serpApiKey,
        braveApiKey,
        firecrawlApiKey: edenApiKey,
        maxResults: 5,
        limitCap: 10,
      });
      if (resp.costUsd) rowSearchCostUsd += resp.costUsd;
      if (resp.results.length > 0) {
        searchSnippets = resp.results
          .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}`)
          .join("\n\n");
        contextParts.push(`## Suchergebnisse (Kontaktdaten)\n${searchSnippets}`);
        sourcesUsed.push("search");
      }
    } catch (e) {
      searchError = (e as Error).message;
    }
  }

  // 4. If we have nothing to work with, try a general web search
  if (contextParts.length === 0 && companyName) {
    try {
      const resp = await webSearch(`${companyName} Telefon Adresse E-Mail`, {
        serpApiKey,
        braveApiKey,
        firecrawlApiKey: edenApiKey,
        maxResults: 5,
      });
      if (resp.costUsd) rowSearchCostUsd += resp.costUsd;
      if (resp.results.length > 0) {
        searchSnippets = resp.results.map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}`).join("\n\n");
        contextParts.push(`## Suchergebnisse\n${searchSnippets}`);
        sourcesUsed.push("search");
      }
    } catch (e) {
      // ignore
    }
  }

  if (contextParts.length === 0) {
    return {
      fields: {},
      scrapeError,
      searchError,
      error: "No content available to extract from",
    };
  }

  // 5. Single LLM call — extract all fields at once
  // Use custom system prompt if provided, otherwise build default
  const systemPrompt = customSystemPrompt?.trim() || buildSystemPrompt(requestedFields);
  const userPrompt = sanitizeForLlm([
    companyName ? `Unternehmen: ${companyName}` : "",
    domain ? `Domain: ${domain}` : "",
    "",
    ...contextParts,
  ].filter(Boolean).join("\n"));

  // Store the prompt for debugging (returned in result)
  const debugPrompt = userPrompt;  // full prompt for modal

  try {
    const resp = await edenChatCompletion({
      apiKey: edenApiKey,
      region: "us",
      model,
      system: systemPrompt,
      prompt: userPrompt,
      maxTokens: 800,  // enough for all fields incl. description
      temperature: 0,
      signal,
    });

    const raw = resp.raw?.trim() ?? "";
    const jsonStr = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      // Try to extract partial JSON
      try {
        const match = jsonStr.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
      } catch { /* use empty */ }
    }

    // Normalize all values to string | null
    const fields: Record<string, string | null> = {};
    for (const field of requestedFields) {
      const val = parsed[field];
      if (val === null || val === undefined || val === "null") {
        fields[field] = null;
      } else {
        const str = String(val).trim();
        fields[field] = str || null;
      }
    }

    // Always set domain from source if not found by LLM
    if (!fields["domain"] && domain) {
      fields["domain"] = normalizeDomainSimple(domain);
    }

    const totalCostUsd = (resp.costUsd ?? 0) + rowScrapeCostUsd + rowSearchCostUsd;

    return {
      fields,
      scrapeMarkdown,
      impressumMarkdown,
      searchSnippets,
      debugPrompt,
      debugRawResponse: resp.raw ?? "",
      sourcesUsed,
      tokensUsed: resp.tokens?.total,
      costUsd: totalCostUsd > 0 ? totalCostUsd : undefined,
      scrapeError,
      searchError,
    };
  } catch (e) {
    return {
      fields: {},
      scrapeError,
      searchError,
      error: (e as Error).message,
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Domains we must never treat as a company's own website (Maps, social media, catalogs, etc.) */
const NON_COMPANY_DOMAINS = new Set([
  "google.com", "maps.google.com", "google.de", "google.at", "google.ch",
  "facebook.com", "instagram.com", "linkedin.com", "xing.com",
  "twitter.com", "x.com", "youtube.com", "tiktok.com",
  "yelp.com", "yelp.de", "tripadvisor.com", "tripadvisor.de",
  "wikipedia.org", "wikidata.org",
  "yellowpages.com", "gelbeseiten.de", "dasoertliche.de", "11880.com",
  "wlw.de", "cylex.de", "kompass.com",
]);

/** Returns true if the URL is a Google Maps link or another known aggregator URL (not a company website). */
function isNonCompanyUrl(url: string): boolean {
  try {
    const u = new URL(url.includes("://") ? url : `https://${url}`);
    // Google Maps URLs: google.com/maps/..., maps.google.com/...
    if ((u.hostname === "google.com" || u.hostname.endsWith(".google.com") ||
         u.hostname === "google.de" || u.hostname.endsWith(".google.de")) &&
        u.pathname.startsWith("/maps")) {
      return true;
    }
    // Apple Maps
    if (u.hostname === "maps.apple.com") return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Resolve the best domain from row data.
 * Priority: domain > source_domain > source_url > website
 *
 * IMPORTANT: source_url is only used if it's NOT a Google Maps / known non-company URL.
 * GMB results without a website have source_url = google.com/maps/... — treating that
 * as a domain would scrape google.com instead of the actual company site.
 */
function resolveDomain(data: Record<string, string | null | undefined>): string {
  const candidates = ["domain", "source_domain"];
  for (const key of candidates) {
    const val = data[key];
    if (!val) continue;
    const d = normalizeDomainSimple(val);
    if (d) return d;
  }
  // source_url is last resort — only if it's not a known non-company URL
  const sourceUrl = data["source_url"];
  if (sourceUrl && !isNonCompanyUrl(sourceUrl)) {
    const d = normalizeDomainSimple(sourceUrl);
    if (d && !NON_COMPANY_DOMAINS.has(d)) return d;
  }
  // website field
  const website = data["website"];
  if (website) {
    const d = normalizeDomainSimple(website);
    if (d) return d;
  }
  return "";
}

function normalizeDomainSimple(raw: string): string {
  try {
    const withScheme = raw.includes("://") ? raw : `https://${raw}`;
    const host = new URL(withScheme).hostname.replace(/^www\./, "").toLowerCase();
    return host.includes(".") ? host : "";
  } catch {
    return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim();
  }
}

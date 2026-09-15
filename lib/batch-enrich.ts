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
    model = "openai/gpt-4o-mini",
    serpApiKey,
    braveApiKey,
    requestedFields = [...BATCH_FIELDS],
    searchContacts = false,  // default off — batch_contacts column handles contacts separately
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

  // 2. Scrape homepage + impressum/kontakt page for company email
  if (domain) {
    if (cachedScrape) {
      scrapeMarkdown = filterScrapedContent(cachedScrape);
    } else {
      try {
        const base = domain.startsWith("http") ? domain : `https://${domain}`;
        const result = await edenScrapeUrl({ apiKey: edenApiKey, url: base });
        scrapeMarkdown = filterScrapedContent(result.markdown?.slice(0, 6000) ?? "");
      } catch (e) {
        scrapeError = (e as Error).message;
      }
    }
    if (scrapeMarkdown?.trim()) {
      contextParts.push(`## Homepage (${domain})\n${scrapeMarkdown}`);
      sourcesUsed.push("scrape");
    }
    // Also scrape impressum/kontakt to find company email & address
    if (!cachedScrape) {
      const base = domain.startsWith("http") ? domain : `https://${domain}`;
      const impressumPaths = ["/impressum", "/kontakt", "/impressum.html", "/kontakt.html", "/about", "/ueber-uns"];
      for (const path of impressumPaths) {
        try {
          const result = await edenScrapeUrl({ apiKey: edenApiKey, url: `${base}${path}` });
          if (result.markdown && result.markdown.length > 150) {
            impressumMarkdown = filterScrapedContent(result.markdown.slice(0, 3000));
            contextParts.push(`## Impressum/Kontakt (${path})\n${impressumMarkdown}`);
            sourcesUsed.push(`impressum:${path}`);
            break;
          }
        } catch { continue; }
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

    return {
      fields,
      scrapeMarkdown,
      impressumMarkdown,
      searchSnippets,
      debugPrompt,
      debugRawResponse: resp.raw ?? "",
      sourcesUsed,
      tokensUsed: resp.tokens?.total,
      costUsd: resp.costUsd,
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

/**
 * Resolve the best domain from row data.
 * Priority: domain > source_domain > source_url > website
 */
function resolveDomain(data: Record<string, string | null | undefined>): string {
  const candidates = ["domain", "source_domain", "source_url", "website"];
  for (const key of candidates) {
    const val = data[key];
    if (!val) continue;
    const d = normalizeDomainSimple(val);
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

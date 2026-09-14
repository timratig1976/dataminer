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
  // Replace lone surrogates (U+D800–U+DFFF) with replacement character
  return text.replace(/[\uD800-\uDFFF]/g, "\uFFFD").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");
}

// ── Output field definitions ──────────────────────────────────────────────────

export const BATCH_FIELDS = [
  "company_name",
  "domain",
  "phone",
  "email",
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
  phone: "Telefon",
  email: "E-Mail",
  address: "Adresse",
  city: "Stadt",
  zip: "PLZ",
  industry: "Branche",
  description: "Beschreibung",
  employees: "Mitarbeiterzahl",
  founded: "Gründungsjahr",
  first_name: "Vorname (Ansprechpartner)",
  last_name: "Nachname (Ansprechpartner)",
  position: "Position (Ansprechpartner)",
  linkedin: "LinkedIn-Profil",
};

// ── System prompt (fixed, cached by LLM provider) ─────────────────────────────

/** Exported so the UI can show the default prompt and offer a "reset to default". */
export function buildSystemPrompt(requestedFields: string[]): string {
  const fieldList = requestedFields
    .map((f) => `  "${f}": "${BATCH_FIELD_LABELS[f as BatchField] ?? f}"`)
    .join(",\n");

  return `Du bist ein präziser Daten-Extraktions-Agent für Unternehmensprofile.
Analysiere die gegebenen Quellen (Website-Inhalt, Suchergebnisse) und extrahiere strukturierte Unternehmensdaten.

Antworte NUR mit JSON (kein Markdown, keine Erklärungen):
{
${fieldList}
}

Regeln:
- Fehlende Felder: null (NICHT weglassen, NICHT raten)
- domain: nur Basis-Domain ohne http/https/www (z.B. "example.de")
- phone: internationales Format wenn möglich (z.B. "+49 381 454000")
- industry: kurze präzise Beschreibung (z.B. "Heizungs-, Sanitär- und Klimatechnik")
- description: 1-2 Sätze was das Unternehmen macht
- Ansprechpartner: nur wenn Name/Position klar erkennbar (kein Raten)
- Wenn mehrere Telefonnummern: die primäre Kontaktnummer`;
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
    searchContacts = true,
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
  let scrapeMarkdown: string | undefined;
  let searchSnippets: string | undefined;
  let scrapeError: string | undefined;
  let searchError: string | undefined;

  // 2. Scrape homepage
  if (domain) {
    if (cachedScrape) {
      scrapeMarkdown = cachedScrape;
    } else {
      try {
        const url = domain.startsWith("http") ? domain : `https://${domain}`;
        const result = await edenScrapeUrl({ apiKey: edenApiKey, url });
        scrapeMarkdown = result.markdown?.slice(0, 8000);  // limit to 8k chars
      } catch (e) {
        scrapeError = (e as Error).message;
        // Continue without scrape — use search results only
      }
    }
    if (scrapeMarkdown?.trim()) {
      contextParts.push(`## Website-Inhalt (${domain})\n${scrapeMarkdown}`);
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
        const snippets = resp.results.map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}`).join("\n\n");
        contextParts.push(`## Suchergebnisse\n${snippets}`);
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
  const debugPrompt = userPrompt.slice(0, 4000);  // full context for modal

  try {
    const resp = await edenChatCompletion({
      apiKey: edenApiKey,
      region: "us",
      model,
      system: systemPrompt,
      prompt: userPrompt,
      maxTokens: 600,  // compact JSON output
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
      searchSnippets,
      debugPrompt,
      debugRawResponse: resp.raw ?? "",
      sourcesUsed: contextParts.map((_, i) => i === 0 && scrapeMarkdown ? "scrape" : "search"),
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

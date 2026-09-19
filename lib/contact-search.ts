/**
 * lib/contact-search.ts
 * Deep contact discovery for a known company.
 *
 * Strategy (in order of reliability):
 *   1. Scrape /impressum and /kontakt pages → Geschäftsführer, Inhaber, direkte Email
 *   2. Google: "{company} Geschäftsführer OR Inhaber OR CEO"
 *   3. Google: "{company} site:linkedin.com"
 *   4. One LLM call synthesizes all sources → structured contact JSON
 *
 * Returns up to `maxContacts` contacts with:
 *   first_name, last_name, position, email, phone, linkedin
 */

import { edenChatCompletion, edenScrapeUrl } from "./edenai";
import { webSearch } from "./search";
import { getCachedScrape, setCachedScrape } from "./db";

/** Strip surrogate pairs and other invalid UTF-16 sequences that Eden AI rejects. */
function sanitizeForLlm(text: string): string {
  return text.replace(/[\uD800-\uDFFF]/g, "\uFFFD").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");
}

/** Remove cookie banners, nav noise, image lines from scraped Impressum content. */
function filterImpressum(markdown: string): string {
  return markdown.split("\n").filter(line => {
    const l = line.trim().toLowerCase();
    if (l.length === 0) return true;
    if (l.includes("einwilligungsoptionen") || l.includes("einstellung zum datenschutz")) return false;
    if (l.includes("cookie") && (l.includes("akzeptier") || l.includes("zustimm") || l.includes("banner") || l.includes("einwillig"))) return false;
    if (l.includes("datenschutz") && (l.includes("hinweis") || l.includes("erkl") || l.includes("einwillig"))) return false;
    if (l.includes("dsgvo") || l.includes("gdpr")) return false;
    if (l.includes("zum inhalt springen") || l.includes("skip to content")) return false;
    if (/^!\[.*?\]\(https?:\/\//.test(line.trim())) return false;
    if (l.includes("wp-content/uploads")) return false;
    if (/^\[.{1,40}\]\(https?:\/\//.test(line.trim()) && line.trim().length < 80) return false;
    return true;
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Contact {
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  source: string;           // e.g. "impressum" | "linkedin_search" | "google"
}

export interface ContactSearchOptions {
  edenApiKey: string;
  directFirecrawlApiKey?: string;
  model?: string;
  serpApiKey?: string;
  braveApiKey?: string;
  maxContacts?: number;
  scrapeImpressum?: boolean;
  searchLinkedIn?: boolean;
  signal?: AbortSignal;
}

export interface ContactSearchResult {
  contacts: Contact[];
  /** Generic company email (info@, kontakt@ etc.) extracted from impressum — separate from personal emails */
  companyEmail?: string | null;
  impressumContent?: string;
  googleSnippets?: string;
  linkedinSnippets?: string;
  systemPrompt?: string;
  tokensUsed?: number;
  costUsd?: number;
  sourcesUsed: string[];
  sourceUrls: string[];
  debugPrompt?: string;
  debugRawResponse?: string;
  error?: string;
}

// ── Impressum page finder ─────────────────────────────────────────────────────

const IMPRESSUM_PATHS = [
  "/impressum", "/impressum.html", "/impressum.php",
  "/kontakt", "/kontakt.html",
  "/about", "/about-us", "/ueber-uns",
  "/team", "/management",
];

async function scrapeImpressumPage(domain: string, apiKey: string): Promise<string> {
  const base = `https://${domain.replace(/^https?:\/\//, "").replace(/^www\./, "")}`;
  for (const path of IMPRESSUM_PATHS) {
    try {
      const result = await edenScrapeUrl({ apiKey, url: `${base}${path}` });
      if (result.markdown && result.markdown.length > 200) {
        // Truncate to relevant section
        return result.markdown.slice(0, 4000);
      }
    } catch {
      continue;
    }
  }
  return "";
}

// ── System prompt ─────────────────────────────────────────────────────────────

const CONTACT_SYSTEM_PROMPT = `Du bist ein Kontaktdaten-Extraktions-Agent.
Analysiere die gegebenen Quellen und extrahiere Kontaktpersonen eines Unternehmens.
Fokus: Entscheider (Geschäftsführer, Inhaber, CEO, Prokurist, Leiter).

Antworte NUR mit JSON:
{
  "contacts": [
    {
      "first_name": "...",
      "last_name": "...",
      "position": "...",
      "email": "...",
      "phone": "...",
      "linkedin": "..."
    }
  ],
  "company_email": "..."  // generische Firmen-Email (info@, kontakt@ etc.) falls im Impressum gefunden, sonst null
}

Regeln:
- Maximal die Top-3 Entscheider
- Fehlende Felder: null
- email: nur direkte Personenemail (nicht info@, nicht kontakt@) — wenn keine persönliche Email, null
- company_email: falls eine generische Firmen-Email im Impressum steht (info@, kontakt@, mail@, office@) — diese HIER eintragen
- linkedin: vollständige URL wenn vorhanden, sonst null
- position: auf Deutsch, kurz (z.B. "Geschäftsführer", "Inhaber", "Vertriebsleiter")
- Kein Raten — nur was eindeutig aus den Quellen hervorgeht`;

// ── Main function ─────────────────────────────────────────────────────────────

export async function searchContacts(
  rowData: Record<string, string | null | undefined>,
  options: ContactSearchOptions
): Promise<ContactSearchResult> {
  const {
    edenApiKey,
    directFirecrawlApiKey,
    model = "openai/gpt-4o-mini",
    serpApiKey,
    braveApiKey,
    maxContacts = 3,
    scrapeImpressum = true,
    searchLinkedIn = true,
    signal,
  } = options;

  const companyName = rowData["company_name"] ?? "";
  const domain = resolveDomain(rowData);
  const city = rowData["city"] ?? "";

  if (!companyName && !domain) {
    return { contacts: [], sourcesUsed: [], sourceUrls: [], error: "Kein Unternehmensname oder Domain vorhanden" };
  }

  const contextParts: string[] = [];
  const sourcesUsed: string[] = [];
  const sourceUrls: string[] = [];
  let impressumContent: string | undefined;
  let googleSnippets: string | undefined;
  let linkedinSnippets: string | undefined;

  // ── 1. Cache-First Impressum & Homepage Resolution ──
  // Check if we already have a scrape in rowData (from batch_company) or in PostgreSQL scrape_cache
  if (scrapeImpressum && domain) {
    const base = `https://${domain.replace(/^https?:\/\//, "").replace(/^www\./, "")}`;
    let rawText = "";
    let sourceOrigin = "";
    let pageUrl = "";

    // A: Check if rowData already carries the scrape from batch_company
    const rowImpressumMd = rowData["_batch_impressum_md"] || rowData["_batch_impressum_md__batch_firmendaten"];
    const rowScrapeMd = rowData["_batch_scrape_md"] || rowData["_batch_scrape_md__batch_firmendaten"];

    if (rowImpressumMd && rowImpressumMd.length > 20) {
      rawText = rowImpressumMd;
      sourceOrigin = "cache:row_impressum";
      pageUrl = `${base}/impressum`;
    } else if (rowScrapeMd && rowScrapeMd.length > 20) {
      rawText = rowScrapeMd;
      sourceOrigin = "cache:row_homepage";
      pageUrl = base;
    }

    // B: Check PostgreSQL scrape_cache for impressum or homepage
    if (!rawText) {
      const cachedImp = await getCachedScrape(`${base}/impressum`).catch(() => null);
      if (cachedImp?.markdown && cachedImp.markdown.length > 20) {
        rawText = cachedImp.markdown;
        sourceOrigin = "cache:db_impressum";
        pageUrl = `${base}/impressum`;
      } else {
        const cachedBase = await getCachedScrape(base).catch(() => null);
        if (cachedBase?.markdown && cachedBase.markdown.length > 20) {
          rawText = cachedBase.markdown;
          sourceOrigin = "cache:db_homepage";
          pageUrl = base;
        }
      }
    }

    // C: Only if NO cache exists: Scrape AT MOST 1 targeted URL (never a blind loop)
    if (!rawText) {
      const targetUrl = `${base}/impressum`;
      try {
        const result = await edenScrapeUrl({
          apiKey: edenApiKey,
          directFirecrawlApiKey,
          url: targetUrl,
          signal,
        });
        if (result.markdown && result.markdown.length > 20) {
          rawText = result.markdown;
          sourceOrigin = "live:scrape_impressum";
          pageUrl = targetUrl;
          await setCachedScrape(targetUrl, result.markdown, result.title).catch(() => {});
        }
      } catch {
        // live scrape failed, proceed to search
      }
    }

    if (rawText) {
      impressumContent = filterImpressum(rawText.slice(0, 4500));
      contextParts.push(`## Impressum / Kontaktdaten (${sourceOrigin})\n${impressumContent}`);
      sourcesUsed.push(sourceOrigin);
      sourceUrls.push(pageUrl);
    }
  }

  // 2. Google: company + decision maker keywords
  if (companyName) {
    try {
      const query = `"${companyName}"${city ? ` ${city}` : ""} Geschäftsführer OR Inhaber OR Prokurist`;
      const resp = await webSearch(query, {
        serpApiKey,
        braveApiKey,
        firecrawlApiKey: edenApiKey,
        maxResults: 5,
      });
      if (resp.results.length > 0) {
        googleSnippets = resp.results
          .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}`)
          .join("\n\n");
        contextParts.push(`## Google-Suche: Entscheider\n${googleSnippets}`);
        sourcesUsed.push("google");
        resp.results.slice(0, 3).forEach(r => sourceUrls.push(r.url));
      }
    } catch { /* ignore */ }
  }

  // 3. LinkedIn search
  if (searchLinkedIn && companyName) {
    try {
      const linkedinQuery = `"${companyName}" site:linkedin.com/in`;
      const resp = await webSearch(linkedinQuery, {
        serpApiKey,
        braveApiKey,
        firecrawlApiKey: edenApiKey,
        maxResults: 5,
      });
      if (resp.results.length > 0) {
        const filtered = resp.results.filter(r => r.url.includes("linkedin.com"));
        if (filtered.length > 0) {
          linkedinSnippets = filtered
            .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`)
            .join("\n\n");
          contextParts.push(`## LinkedIn-Profile\n${linkedinSnippets}`);
          sourcesUsed.push("linkedin");
          filtered.slice(0, 3).forEach(r => sourceUrls.push(r.url));
        }
      }
    } catch { /* ignore */ }
  }

  if (contextParts.length === 0) {
    return { contacts: [], sourcesUsed: [], sourceUrls: [], error: "Keine Quellen gefunden" };
  }

  // 4. One LLM call → structured contacts
  const userPrompt = sanitizeForLlm([
    `Unternehmen: ${companyName}`,
    domain ? `Domain: ${domain}` : "",
    city ? `Stadt: ${city}` : "",
    `Gesucht: Top-${maxContacts} Entscheider`,
    "",
    ...contextParts,
  ].filter(Boolean).join("\n"));

  // Store for debugging
  const debugPrompt = userPrompt.slice(0, 2000);
  const debugSources = sourcesUsed;

  try {
    const resp = await edenChatCompletion({
      apiKey: edenApiKey,
      region: "us",
      model,
      system: CONTACT_SYSTEM_PROMPT,
      prompt: userPrompt,
      maxTokens: 800,
      temperature: 0,
      signal,
    });

    const raw = resp.raw?.trim() ?? "";
    const jsonStr = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();

    let parsed: { contacts?: Contact[] } = {};
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      const match = jsonStr.match(/\{[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); } catch { /* empty */ }
      }
    }

    const contacts: Contact[] = (parsed.contacts ?? [])
      .slice(0, maxContacts)
      .map((c: Partial<Contact>) => ({
        first_name: c.first_name ?? null,
        last_name: c.last_name ?? null,
        position: c.position ?? null,
        email: c.email ?? null,
        phone: c.phone ?? null,
        linkedin: c.linkedin ?? null,
        source: sourcesUsed.join("+"),
      }));

    // Extract generic company email as separate fallback
    const companyEmail: string | null = (parsed as { company_email?: string | null }).company_email ?? null;

    return {
      contacts,
      companyEmail,
      impressumContent,
      googleSnippets,
      linkedinSnippets,
      systemPrompt: CONTACT_SYSTEM_PROMPT,
      tokensUsed: resp.tokens?.total,
      costUsd: resp.costUsd,
      sourcesUsed,
      sourceUrls,
      debugPrompt: userPrompt.slice(0, 4000),
      debugRawResponse: resp.raw ?? "",
    };
  } catch (e) {
    return {
      contacts: [],
      sourcesUsed,
      sourceUrls,
      error: (e as Error).message,
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveDomain(data: Record<string, string | null | undefined>): string {
  for (const key of ["domain", "source_domain", "source_url", "website"]) {
    const val = data[key];
    if (!val) continue;
    try {
      const withScheme = val.includes("://") ? val : `https://${val}`;
      const host = new URL(withScheme).hostname.replace(/^www\./, "").toLowerCase();
      if (host.includes(".")) return host;
    } catch {
      const bare = val.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim();
      if (bare.includes(".")) return bare;
    }
  }
  return "";
}

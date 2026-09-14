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

/** Strip surrogate pairs and other invalid UTF-16 sequences that Eden AI rejects. */
function sanitizeForLlm(text: string): string {
  return text.replace(/[\uD800-\uDFFF]/g, "\uFFFD").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");
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
  ]
}

Regeln:
- Maximal die Top-3 Entscheider
- Fehlende Felder: null
- email: nur direkte Personenemail (nicht info@, nicht kontakt@) — wenn keine persönliche Email, null
- linkedin: vollständige URL wenn vorhanden, sonst null
- position: auf Deutsch, kurz (z.B. "Geschäftsführer", "Inhaber", "Vertriebsleiter")
- Kein Raten — nur was eindeutig aus den Quellen hervorgeht
- Generische Emails (info@, kontakt@, mail@, office@) → null für die Person, diese gehören zur Firma`;

// ── Main function ─────────────────────────────────────────────────────────────

export async function searchContacts(
  rowData: Record<string, string | null | undefined>,
  options: ContactSearchOptions
): Promise<ContactSearchResult> {
  const {
    edenApiKey,
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

  // 1. Scrape Impressum / Kontakt page
  if (scrapeImpressum && domain) {
    try {
      const base = `https://${domain.replace(/^https?:\/\//, "").replace(/^www\./, "")}`;
      let impressumText = "";
      let impressumUrl = "";
      for (const path of ["/impressum", "/impressum.html", "/kontakt", "/kontakt.html", "/about", "/team", "/management"]) {
        try {
          const result = await edenScrapeUrl({ apiKey: edenApiKey, url: `${base}${path}` });
          if (result.markdown && result.markdown.length > 200) {
            impressumText = result.markdown.slice(0, 4000);
            impressumUrl = `${base}${path}`;
            break;
          }
        } catch { continue; }
      }
      if (impressumText) {
        contextParts.push(`## Impressum / Kontaktseite (${domain})\n${impressumText}`);
        sourcesUsed.push("impressum");
        sourceUrls.push(impressumUrl || `${base}/impressum`);
      }
    } catch { /* ignore */ }
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
        const snippets = resp.results
          .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}`)
          .join("\n\n");
        contextParts.push(`## Google-Suche: Entscheider\n${snippets}`);
        sourcesUsed.push("google_management");
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
        const snippets = resp.results
          .filter(r => r.url.includes("linkedin.com"))
          .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`)
          .join("\n\n");
        if (snippets) {
          contextParts.push(`## LinkedIn-Profile\n${snippets}`);
          sourcesUsed.push("linkedin");
          resp.results.filter(r => r.url.includes("linkedin.com")).slice(0, 3).forEach(r => sourceUrls.push(r.url));
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

    return {
      contacts,
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

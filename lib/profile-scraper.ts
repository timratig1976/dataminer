/**
 * lib/profile-scraper.ts
 * Special scraper for small firms without their own website.
 *
 * Strategy:
 *  1. Serper/SerpApi: search "Firmenname Ort" → find a catalog profile URL
 *     (dastelefonbuch.de, gelbeseiten.de, dasoertliche.de, etc.)
 *  2. Firecrawl: scrape that profile page → Markdown
 *  3. LLM: extract phone, address, email, website from the profile
 *  4. If a real website is found on the profile → use it as domain
 *     Otherwise → store profile_url so the data is enriched regardless
 */

import { edenScrapeUrl, edenChatCompletion } from "./edenai";
import { webSearch } from "./search";
import { getCachedScrape, setCachedScrape } from "./db";

// ── Known catalog/directory domains we CAN scrape for profile data ───────────
// These are good sources of structured contact info
const PROFILE_SOURCES = new Set([
  "dastelefonbuch.de",
  "gelbeseiten.de",
  "dasoertliche.de",
  "11880.com",
  "cylex.de",
  "wlw.de",
  "europages.de",
  "handwerker-markt.de",
  "my-hammer.de",
  "trustlocal.de",
  "yelp.de",
  "branchenbuch.de",
  "golocal.de",
  "meinestadt.de",
  "stadtbranchenbuch.com",
  "firmendb.de",
  "meinbezirk.at",
  "herold.at",
]);

// Domains we should NEVER accept as a firm's own website
export const WEBSITE_BLOCKLIST = new Set([
  ...Array.from(PROFILE_SOURCES),
  "google.com", "google.de", "bing.com", "duckduckgo.com",
  "wikipedia.org", "de.wikipedia.org", "en.wikipedia.org", "wikidata.org",
  "facebook.com", "instagram.com", "linkedin.com", "xing.com",
  "kununu.com", "twitter.com", "x.com", "tiktok.com", "youtube.com",
  "amazon.de", "amazon.com", "ebay.de", "ebay.com",
  "hornbach.de", "obi.de", "bauhaus.info", "hagebau.de", "toom.de",
  "gesetze-im-internet.de", "bundesanzeiger.de", "handelsregister.de",
  "northdata.de", "opencorporates.com",
  "indeed.de", "stepstone.de", "glassdoor.de", "arbeitsagentur.de",
  "lotto.pl", "lotto.de",
]);

export interface ProfileScrapeResult {
  /** The profile page URL on a catalog site */
  profileUrl: string | null;
  /** Own website domain if found on the profile */
  domain: string | null;
  /** Enriched contact data extracted from profile */
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  zip: string | null;
  /** Source catalog domain (e.g. dastelefonbuch.de) */
  profileSource: string | null;
  /** Raw LLM extraction confidence */
  confidence: "high" | "low" | "none";
}

const PROFILE_EXTRACTION_SYSTEM = `Du bist ein Daten-Extraktions-Agent für Firmen-Profile auf Verzeichnisseiten.
Extrahiere die Kontaktdaten der EINEN gelisteten Firma aus dem Markdown.

Antworte NUR mit JSON:
{
  "company_name": "...",
  "phone": "...",
  "email": "...",
  "address": "...",
  "city": "...",
  "zip": "...",
  "website": "...",
  "description": "..."
}

Regeln:
- website: NUR die eigene Website der Firma (nicht die Verzeichnis-Domain selbst)
- Fehlende Felder: null
- phone: vollständige Nummer inkl. Vorwahl`;

export async function scrapeCompanyProfile(params: {
  companyName: string;
  city: string | null;
  phone: string | null;
  edenApiKey: string;
  serperApiKey?: string;
  serpApiKey?: string;
  braveApiKey?: string;
  model?: string;
}): Promise<ProfileScrapeResult> {
  const {
    companyName,
    city,
    phone,
    edenApiKey,
    serperApiKey,
    serpApiKey,
    braveApiKey,
    model = "openai/gpt-4o-mini",
  } = params;

  const empty: ProfileScrapeResult = {
    profileUrl: null, domain: null, phone: null, email: null,
    address: null, city: null, zip: null, profileSource: null, confidence: "none",
  };

  if (!edenApiKey) return empty;

  // ── Step 1: Find profile URL via web search ───────────────────────────────
  const query = city ? `"${companyName}" ${city}` : `"${companyName}"`;
  let profileUrl: string | null = null;
  let profileSource: string | null = null;

  try {
    const resp = await webSearch(query, {
      serperApiKey, serpApiKey, braveApiKey,
      maxResults: 5, limitCap: 8,
    });

    for (const r of resp.results) {
      try {
        const url = new URL(r.url);
        const hostname = url.hostname.replace(/^www\./, "").toLowerCase();
        if (PROFILE_SOURCES.has(hostname)) {
          // Make sure it's a company profile page (not a category/search page)
          const path = url.pathname.toLowerCase();
          const isProfilePage =
            path.split("/").length >= 3 &&          // at least /cat/company
            !path.endsWith("/") ||
            path.includes(companyName.toLowerCase().replace(/\s+/g, "-").slice(0, 10));
          if (isProfilePage || PROFILE_SOURCES.has(hostname)) {
            profileUrl = r.url;
            profileSource = hostname;
            break;
          }
        }
      } catch { /* skip */ }
    }
  } catch { return empty; }

  if (!profileUrl) return { ...empty, confidence: "none" };

  // ── Step 2: Scrape the profile page ──────────────────────────────────────
  let markdown = "";
  try {
    const cached = await getCachedScrape(profileUrl).catch(() => null);
    if (cached?.markdown) {
      markdown = cached.markdown;
    } else {
      const scraped = await edenScrapeUrl({ apiKey: edenApiKey, url: profileUrl });
      markdown = scraped.markdown ?? "";
      if (markdown.trim()) await setCachedScrape(profileUrl, markdown, scraped.title).catch(() => {});
    }
  } catch { return { ...empty, profileUrl, profileSource, confidence: "none" }; }

  if (!markdown.trim()) {
    return { ...empty, profileUrl, profileSource, confidence: "none" };
  }

  // Truncate to ~4k chars (enough for a single profile page)
  const cleaned = markdown.slice(0, 4000);

  // ── Step 3: LLM extraction ────────────────────────────────────────────────
  let extracted: {
    company_name?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    city?: string | null;
    zip?: string | null;
    website?: string | null;
    description?: string | null;
  } = {};

  try {
    const resp = await edenChatCompletion({
      apiKey: edenApiKey,
      region: "us",
      model,
      system: PROFILE_EXTRACTION_SYSTEM,
      prompt: `Firma gesucht: "${companyName}"${city ? `, ${city}` : ""}\n\nProfilseite:\n${cleaned}`,
      maxTokens: 400,
      temperature: 0,
    });
    const raw = (resp.raw ?? "").replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    extracted = JSON.parse(raw);
  } catch { extracted = {}; }

  // Confidence: high if name matches, low if data found but uncertain
  const nameMatch = extracted.company_name
    ? companyName.toLowerCase().includes(extracted.company_name.toLowerCase().slice(0, 6)) ||
      extracted.company_name.toLowerCase().includes(companyName.toLowerCase().slice(0, 6))
    : false;
  const confidence = nameMatch ? "high" : (extracted.phone || extracted.email) ? "low" : "none";

  // Extract own website domain
  let domain: string | null = null;
  if (extracted.website) {
    try {
      const h = new URL(
        extracted.website.startsWith("http") ? extracted.website : `https://${extracted.website}`
      ).hostname.replace(/^www\./, "").toLowerCase();
      if (!WEBSITE_BLOCKLIST.has(h) && h.includes(".")) domain = h;
    } catch { /* skip */ }
  }

  return {
    profileUrl,
    domain,
    phone: extracted.phone ?? phone ?? null,
    email: extracted.email ?? null,
    address: extracted.address ?? null,
    city: extracted.city ?? city ?? null,
    zip: extracted.zip ?? null,
    profileSource,
    confidence,
  };
}

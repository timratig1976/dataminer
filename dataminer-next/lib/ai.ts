import OpenAI from "openai";
import type { AiColumn } from "./types";

function renderPrompt(template: string, data: Record<string, string | null>): string {
  return template.replace(/\{([^}]+)\}/g, (_, key) => {
    const val = data[key.trim()];
    return (val != null && String(val).trim() !== "") ? String(val) : "(not provided)";
  });
}

function checkCondition(column: AiColumn, data: Record<string, string | null>): { skip: boolean; reason?: string } {
  if (!column.condition || !column.conditionField) return { skip: false };
  const fieldValue = data[column.conditionField];
  if (column.condition === "empty" && fieldValue && String(fieldValue).trim() !== "") {
    return { skip: true, reason: `${column.conditionField} already has value` };
  }
  if (column.condition === "not_empty" && (!fieldValue || String(fieldValue).trim() === "")) {
    return { skip: true, reason: `${column.conditionField} is empty` };
  }
  if (column.condition === "require_input" && (!fieldValue || String(fieldValue).trim() === "")) {
    return { skip: true, reason: `required input '${column.conditionField}' is missing` };
  }
  return { skip: false };
}

function extractJsonKey(raw: string, key: string): string {
  try {
    const parsed = JSON.parse(raw);
    return parsed[key] != null ? String(parsed[key]) : "";
  } catch {
    const match = raw.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`) );
    return match ? match[1] : "";
  }
}

async function validateDomain(
  domain: string,
  companyName: string
): Promise<{ valid: boolean; reason: string }> {
  if (!domain || domain === "notFound") return { valid: false, reason: "empty domain" };

  const normalised = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase().trim();
  if (!normalised || !normalised.includes(".")) return { valid: false, reason: "malformed domain" };

  const urls = [`https://${normalised}`, `https://www.${normalised}`];
  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; DataMiner/1.0)" },
        redirect: "follow",
      });
      clearTimeout(timer);
      if (!res.ok) continue;

      const html = (await res.text()).toLowerCase().slice(0, 12000);

      // Extract keywords from company name (split on spaces, hyphens, underscores)
      const keywords = companyName.toLowerCase()
        .split(/[\s\-_&+]+/)
        .map(w => w.replace(/[^a-z0-9äöüß]/g, ""))
        .filter(w => w.length > 3 && !["gmbh","und","the","ltd","inc","corp","service","services","group"].includes(w));

      // Also add the domain slug itself as a signal
      const domainSlug = normalised.split(".")[0].replace(/-/g, "");
      const allSignals = [...keywords, domainSlug];

      const matched = allSignals.some(kw => html.includes(kw));
      return {
        valid: matched,
        reason: matched ? "HTTP OK + brand match" : `HTTP OK but no brand signals found (tried: ${allSignals.slice(0,5).join(", ")})`,
      };
    } catch {
      continue;
    }
  }
  return { valid: false, reason: "unreachable" };
}

export async function runAiColumn(
  column: AiColumn,
  rowData: Record<string, string | null>,
  apiKey: string
): Promise<{ value: string; skipped?: boolean; skipReason?: string; error?: string; multiValues?: Record<string, string>; rawResponse?: string; renderedPrompt?: string; tokens?: { prompt: number; completion: number; total: number }; costUsd?: number }> {
  const condCheck = checkCondition(column, rowData);
  if (condCheck.skip) {
    return { value: rowData[column.outputKey] ?? "", skipped: true, skipReason: condCheck.reason };
  }

  // Domain validator — deterministic, no LLM
  if (column.model === "validator") {
    const domain = rowData[column.conditionField ?? "official_domain"] ?? "";
    const company = rowData["company_name"] ?? "";
    const result = await validateDomain(domain, company);
    return { value: result.valid ? domain : `invalid (${result.reason})` };
  }

  const prompt = renderPrompt(column.prompt, rowData);
  if (!prompt.trim()) return { value: "", error: "Empty prompt after rendering" };

  const maxTokens = column.outputMode === "json" ? 1024 : 512;

  try {
    const client = new OpenAI({ apiKey, timeout: 45000 });
    const isJson = column.outputMode === "json";
    const resp = await client.chat.completions.create({
      model: column.model || "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: isJson
            ? "You are a data enrichment assistant. Return ONLY valid JSON, no markdown, no explanation."
            : "You are a data enrichment assistant. Return only the requested value, nothing else. If you cannot find the information, return exactly: notFound",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: maxTokens,
      temperature: 0,
    });
    const raw = resp.choices[0]?.message?.content?.trim() ?? "";
    const usage = resp.usage;
    console.log(`[LLM] model=${column.model ?? "gpt-4o-mini"} prompt_tokens=${usage?.prompt_tokens} completion_tokens=${usage?.completion_tokens} raw_length=${raw.length} raw_preview=${raw.slice(0,120)}`);
    const tokens = usage ? { prompt: usage.prompt_tokens ?? 0, completion: usage.completion_tokens ?? 0, total: usage.total_tokens ?? 0 } : undefined;
    // Cost estimate: gpt-4o-mini = $0.15/1M input, $0.60/1M output; gpt-4o = $2.50/1M input, $10/1M output
    const model = column.model ?? "gpt-4o-mini";
    const inRate = model.includes("gpt-4o-mini") ? 0.15 : model.includes("gpt-4o") ? 2.50 : 0.15;
    const outRate = model.includes("gpt-4o-mini") ? 0.60 : model.includes("gpt-4o") ? 10.00 : 0.60;
    const costUsd = tokens ? (tokens.prompt * inRate + tokens.completion * outRate) / 1_000_000 : undefined;

    // Multi-key mode: write multiple output fields from one JSON response
    if (isJson && column.multiKeys && column.multiKeys.length > 0) {
      const multiValues: Record<string, string> = {};
      for (const mk of column.multiKeys) {
        const extracted = extractJsonKey(raw, mk.jsonKey);
        multiValues[mk.outputKey] = extracted === "notFound" ? "" : extracted;
      }

      // Inline domain validation — run HTTP check on the found domain
      if (column.validateDomain) {
        const foundDomain = multiValues["official_domain"] ?? "";
        const company = rowData["company_name"] ?? "";
        if (foundDomain) {
          const validation = await validateDomain(foundDomain, company);
          multiValues["domain_validated"] = validation.valid
            ? `✓ ${foundDomain}`
            : `✗ ${validation.reason}`;
        } else {
          multiValues["domain_validated"] = "✗ no domain returned by GPT";
        }
      }

      const primaryKey = column.multiKeys[0];
      return {
        value: multiValues[primaryKey.outputKey] ?? "",
        multiValues,
        rawResponse: raw,
        renderedPrompt: prompt,
        tokens,
        costUsd,
      };
    }

    if (isJson && column.jsonKey) {
      const extracted = extractJsonKey(raw, column.jsonKey);
      return { value: extracted === "notFound" ? "" : extracted, rawResponse: raw, renderedPrompt: prompt, tokens, costUsd };
    }

    return { value: raw === "notFound" ? "" : raw, rawResponse: raw, renderedPrompt: prompt, tokens, costUsd };
  } catch (err: any) {
    return { value: "", error: String(err?.message ?? err) };
  }
}

export const DEFAULT_PRESETS: Omit<AiColumn, "id">[] = [
  {
    name: "Official Domain",
    outputKey: "official_domain",
    model: "gpt-4o-mini",
    outputMode: "json",
    jsonKey: "domain",
    multiKeys: [
      { jsonKey: "domain", outputKey: "official_domain" },
    ],
    validateDomain: true,
    prompt: `#CONTEXT#
You are an AI-powered web researcher tasked with finding the official website domain of a company using open web search. You will use the company's name to identify the correct official domain and return it in a structured format. Avoid paywalled or authenticated sources.

#OBJECTIVE#
Find the official primary domain for the given company name using web search and return it as a clean domain (e.g., example.com). If uncertain or no authoritative result is found, indicate that no domain could be confidently determined.

#INSTRUCTIONS#
1. Query formulation:
   - Search the web for the company name combined with keywords like "official website", "site", or "homepage".
   - Prefer results from authoritative sources: the company's own site, Wikipedia/Crunchbase pages linking to the official site, reputable directories (e.g., Bloomberg, government registries) that list the official website.

2. Identification of the official domain:
   - Prioritize the company's own homepage result. Verify that the site branding and company name match the searched company name.
   - If multiple domains appear, select the one most clearly representing the company's global/primary website (avoid regional microsites unless the company only operates regionally).
   - Exclude social profiles (LinkedIn, Twitter/X, Facebook), link shorteners, app store links, and third-party SaaS portals.

3. Disambiguation and validation:
   - If the company name is generic or there are multiple companies with similar names, use contextual clues on the site (logo, about page, footer legal entity) to confirm the match.
   - Cross-check with at least one secondary reputable source (e.g., Wikipedia, Crunchbase, Bloomberg) that lists the same official website when ambiguity exists.

4. Domain normalization:
   - Return only the registrable domain and public suffix (e.g., example.com, example.co.uk). Remove protocols (http/https), subdomains (www., app.), paths, UTM parameters, and fragments.
   - If the brand operates only on a country TLD or multi-part TLD (e.g., .com.au, .co.uk), keep the correct full suffix.

5. Edge cases:
   - If only a subdomain is visible (e.g., www.example.com), normalize to example.com unless the subdomain is the actual primary site for the brand.
   - If no definitive official site can be found, output confidence: "notFound" and leave domain empty.

6. Disambiguation using additional context:
   - If a city, postal code, or street address is provided, use it to disambiguate between companies with similar names. Prefer the domain of the company located in that city/region.
   - If an input URL hint is provided, treat it as a strong signal — verify it belongs to the correct company before accepting it.
   - If a legal form is visible in the company name (GmbH, AG, KG, e.K., UG etc.), use it to narrow the search.

7. Output rules:
   - Output JSON with camelCase keys only: { "domain": string, "confidence": "high"|"medium"|"low"|"notFound", "sourceUrl": string }
   - Use "high" when the domain is confirmed on the company's homepage and corroborated or clearly unambiguous; "medium" for strong but not fully corroborated matches; "low" when weak signals suggest a match; "notFound" if no reliable domain.
   - For sourceUrl, provide the most authoritative page used (prefer the company homepage or an authoritative directory entry).

#INPUTS#
Company Name: {company_name}
City / Region (if available): {city}
Postal Code (if available): {plz}
Street (if available): {street}
Input URL hint (if available): {input_url}`,
    condition: "require_input",
    conditionField: "company_name",
  },
  {
    name: "Industry Keywords",
    outputKey: "industry_keywords",
    model: "gpt-4o-mini",
    outputMode: "json",
    jsonKey: "keywords",
    prompt: `#CONTEXT#
You need to extract keywords related to industry and branch from a company's website for later industry classification.

#OBJECTIVE#
Visit the company's home page and extract relevant keywords that indicate the company's industry and branch.

#INSTRUCTIONS#
1. Go to the URL provided (the official domain).
2. Scrape the visible text content from the home page.
3. Identify and extract keywords or phrases that are relevant to the company's industry and branch (e.g., "healthcare", "software development", "retail", "manufacturing").
4. Return a concise list of these keywords. If no relevant keywords are found, return ["notFound"].
5. Do not infer or guess missing data—only extract what is present on the home page.

#INPUTS#
Company: {company_name}
Website: {official_domain}

Return JSON: { "keywords": ["keyword1", "keyword2", ...] }`,
    condition: "require_input",
    conditionField: "official_domain",
  },
  {
    name: "Decision Makers",
    outputKey: "decision_makers_json",
    model: "gpt-4o-mini",
    outputMode: "json",
    jsonKey: "contacts",
    prompt: `#CONTEXT#
You're a data-driven B2B researcher focused on finding any possible marketing relevant contacts. Given a company website, your task is to identify all key decision-makers (owner, managing director, head of operations, head of marketing, head of sales etc.) and build a simple contact profile for each.

#OBJECTIVE#
Identify all key decision-makers at the company and build a simple contact profile as basis for further enrichment.

#INSTRUCTIONS#
1. Scrape the company's Imprint, Team, About Us, or Contact pages (e.g., /impressum) to identify key persons (owner, managing director, head of operations, head of marketing, head of sales etc.).
2. Extract for each found person: full name, title, direct email, and phone number. Include every email you find, at least try to find a catch-all like info@.
3. If missing, search Northdata, OpenRegisters, or CompanyHouse for legal or executive records. Search northdata.de for the company using the exact domain.
4. Identify the location of the contact and verify the correct found names to prevent misspelling.
5. For email discovery, use Google dorks:
   - site:{official_domain} intext:@
   - site:{official_domain} filetype:pdf "@"
   - "@{official_domain}" -site:{official_domain}
   Determine the email pattern and estimate emails for found persons if no direct email found.
6. Set email_source to "Scraped" if found directly, "Estimated" if guessed from pattern.

#INPUTS#
Company: {company_name}
Domain: {official_domain}

Return JSON: { "contacts": [ { "name": "", "firstname": "", "surname": "", "jobtitle": "", "location": "", "phone": "", "mobile": "", "email": "", "email_source": "Scraped|Estimated", "email_pattern": "" } ], "dork_results": [ { "email": "", "source": "" } ] }`,
    condition: "require_input",
    conditionField: "official_domain",
  },
  {
    name: "Social Profiles",
    outputKey: "social_profiles_json",
    model: "gpt-4o-mini",
    outputMode: "json",
    jsonKey: "LinkedIn",
    prompt: `#CONTEXT#
You are tasked with finding all existing social media profiles for a given contact. The target platforms are LinkedIn, Xing, X (formerly Twitter), Instagram, and Facebook. Use the provided contact information to maximize accuracy.

#OBJECTIVE#
Identify and extract all available social media profile URLs for the contact, specifically for LinkedIn, Xing, X, Instagram, and Facebook.

#INSTRUCTIONS#
1. Use the following contact info to search: name, job title, company name, domain.
2. For each platform (LinkedIn, Xing, X, Instagram, Facebook), search for personal profiles matching the contact's details.
3. Validate that each found profile matches the contact by cross-referencing available details (e.g., job title, company, location).
4. Return the URLs for each platform. If no profile is found for a platform, return "notFound".
5. Do not include company or group pages—only personal profiles.

#INPUTS#
Company: {company_name}
Domain: {official_domain}
Contact Name: {decision_makers_json}

Return JSON: { "LinkedIn": "", "Xing": "", "X": "", "Instagram": "", "Facebook": "" }`,
    condition: "require_input",
    conditionField: "decision_makers_json",
  },
  {
    name: "Background Check",
    outputKey: "background_check_json",
    model: "gpt-4o-mini",
    outputMode: "json",
    jsonKey: "public_mentions",
    prompt: `#CONTEXT#
You're a data-driven B2B researcher focused on hyper-personalized outreach. Given a company website and decision maker data, your task is to identify mentions, interests, social information, and any other info for ultra-personalized contact approach.

#OBJECTIVE#
Identify social information for given contacts and build a comprehensive, ultra-personalized contact profile for outreach.

#INSTRUCTIONS#
1. Include notable local news, construction projects, awards, or public mentions related to the company or key person.
2. Use the person's social media profiles for more information.
3. Scan public mentions: Google News (press, interviews, project launches), YouTube (speaking engagements, company tours, interviews), local municipality pages.
4. Extract personalization angles: recent events (e.g., topping out ceremony, company anniversary), interests, community involvement, awards, local activity, pain points, or growth areas from public data.
5. For every found information provide the full URL to the source.

#INPUTS#
Company: {company_name}
Domain: {official_domain}
Contact: {decision_makers_json}
Social Profiles: {social_profiles_json}

Return JSON: { "name": "", "hobbies_interests": "", "public_mentions": "", "referenced_news_events": "", "mutual_interests": "", "needs_opportunities": "", "links_to_verify": [] }`,
    condition: "require_input",
    conditionField: "official_domain",
  },
  {
    name: "Email",
    outputKey: "email",
    model: "gpt-4o-mini",
    outputMode: "text",
    prompt: `Find the general contact email address for this company.
Company: {company_name}
Website: {official_domain}

Return ONLY the email address. If not found, return: notFound`,
    condition: "empty",
    conditionField: "email",
  },
  {
    name: "Phone",
    outputKey: "phone",
    model: "gpt-4o-mini",
    outputMode: "text",
    prompt: `Find the main phone number for this company.
Company: {company_name}
Website: {official_domain}

Return ONLY the phone number in international format. If not found, return: notFound`,
    condition: "empty",
    conditionField: "phone",
  },
  {
    name: "LinkedIn (Company)",
    outputKey: "linkedin",
    model: "gpt-4o-mini",
    outputMode: "text",
    prompt: `Find the LinkedIn company page URL for this company.
Company: {company_name}
Website: {official_domain}

Return ONLY the full LinkedIn URL (https://www.linkedin.com/company/...). If not found, return: notFound`,
    condition: "empty",
    conditionField: "linkedin",
  },
  {
    name: "City / PLZ",
    outputKey: "city",
    model: "gpt-4o-mini",
    outputMode: "text",
    prompt: `Find the city and postal code (PLZ) of the headquarters of this company.
Company: {company_name}
Website: {official_domain}

Return ONLY in format: PLZ City (e.g. 80331 München). If not found, return: notFound`,
    condition: "empty",
    conditionField: "city",
  },
];

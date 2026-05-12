import OpenAI from "openai";
import type { AiColumn } from "./types";
import { webSearch, formatSearchResultsForLlm } from "./search";

type LlmProvider = "openai" | "cerebras" | "anthropic";

export function inferProviderFromModel(model?: string): LlmProvider {
  if (!model) return "openai";
  const m = model.toLowerCase();
  if (m.startsWith("claude")) return "anthropic";
  if (
    m.startsWith("llama") ||
    m.includes("cerebras") ||
    m.includes("qwen") ||
    m.includes("gpt-oss") ||
    m.includes("zai-glm") ||
    m.startsWith("glm") ||
    m.includes("deepseek") ||
    m.includes("kimi") ||
    m.includes("minimax") ||
    m.includes("mistral")
  ) {
    return "cerebras";
  }
  return "openai";
}

async function runAnthropicCompletion(params: {
  apiKey: string;
  model: string;
  prompt: string;
  isJson: boolean;
  maxTokens: number;
  systemOverride?: string;
}): Promise<{ raw: string; tokens?: { prompt: number; completion: number; total: number } }> {
  const { apiKey, model, prompt, isJson, maxTokens, systemOverride } = params;
  const system = systemOverride ?? (isJson
    ? "You are a data enrichment assistant. Return ONLY valid JSON, no markdown, no explanation."
    : "You are a data enrichment assistant. Return only the requested value, nothing else. If you cannot find the information, return exactly: notFound");

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const json = await resp.json();
  if (!resp.ok) {
    const msg = json?.error?.message || json?.error?.type || `HTTP ${resp.status}`;
    throw new Error(msg);
  }

  const raw = Array.isArray(json?.content)
    ? json.content
        .filter((c: { type?: string }) => c?.type === "text")
        .map((c: { text?: string }) => c?.text ?? "")
        .join("\n")
        .trim()
    : "";

  const usage = json?.usage;
  const promptTokens = Number(usage?.input_tokens ?? 0);
  const completionTokens = Number(usage?.output_tokens ?? 0);
  const tokens = usage
    ? {
        prompt: promptTokens,
        completion: completionTokens,
        total: promptTokens + completionTokens,
      }
    : undefined;

  return { raw, tokens };
}

function estimateCostUsd(model: string, tokens?: { prompt: number; completion: number; total: number }): number | undefined {
  if (!tokens) return undefined;

  const m = model.toLowerCase();

  if (m.includes("gpt-4o-mini")) {
    return (tokens.prompt * 0.15 + tokens.completion * 0.60) / 1_000_000;
  }
  if (m.includes("gpt-4o")) {
    return (tokens.prompt * 2.5 + tokens.completion * 10.0) / 1_000_000;
  }

  return undefined;
}

function isOpenAiReasoningModel(model: string): boolean {
  const m = model.toLowerCase();
  return m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4");
}

function isOpenAiResponsesOnlyModel(model: string): boolean {
  const m = model.toLowerCase();
  return m.startsWith("o3-pro") || m.includes("deep-research");
}

function extractResponsesText(resp: unknown): string {
  const r = resp as {
    output_text?: unknown;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };

  if (typeof r.output_text === "string" && r.output_text.trim()) {
    return r.output_text.trim();
  }

  if (Array.isArray(r.output)) {
    return r.output
      .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
      .filter((part) => part?.type === "output_text" || part?.type === "text")
      .map((part) => part?.text ?? "")
      .join("\n")
      .trim();
  }

  return "";
}

function renderPrompt(template: string, data: Record<string, string | null>, mapping?: Record<string, string>): string {
  return template.replace(/\{([^}]+)\}/g, (_, key) => {
    const placeholder = key.trim();
    const sourceKey = mapping?.[placeholder]?.trim() || placeholder;
    const val = data[sourceKey];
    return (val != null && String(val).trim() !== "") ? String(val) : "(not provided)";
  });
}

function checkRequiredInputs(column: AiColumn, data: Record<string, string | null>): { skip: boolean; reason?: string } {
  if (!column.requiredFields || column.requiredFields.length === 0) return { skip: false };

  for (const required of column.requiredFields) {
    const sourceField = column.inputMappings?.[required]?.trim();
    if (!sourceField) {
      return { skip: true, reason: `required mapping '${required}' is missing` };
    }
    const val = data[sourceField];
    if (!val || String(val).trim() === "") {
      return { skip: true, reason: `required field '${sourceField}' is empty` };
    }
  }

  return { skip: false };
}

function checkCondition(column: AiColumn, data: Record<string, string | null>): { skip: boolean; reason?: string } {
  if (!column.condition || !column.conditionField) return { skip: false };
  // Resolve through inputMappings if available (conditionField may be a logical name)
  const resolvedField = column.inputMappings?.[column.conditionField] || column.conditionField;
  const fieldValue = data[resolvedField] ?? data[column.conditionField];
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
  apiKey: string,
  provider: LlmProvider = "openai"
): Promise<{ value: string; skipped?: boolean; skipReason?: string; error?: string; multiValues?: Record<string, string>; rawResponse?: string; renderedPrompt?: string; tokens?: { prompt: number; completion: number; total: number }; costUsd?: number }> {
  const requiredCheck = checkRequiredInputs(column, rowData);
  if (requiredCheck.skip) {
    return { value: rowData[column.outputKey] ?? "", skipped: true, skipReason: requiredCheck.reason };
  }

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

  // ── System message builder ─────────────────────────────────────────────────
  function buildSystemMessage(isJson: boolean, hasWebSearch: boolean, captureReasoning: boolean): string {
    const base = isJson
      ? "You are a data enrichment assistant. Return ONLY valid JSON, no markdown, no explanation."
      : "You are a data enrichment assistant. Return only the requested value, nothing else. If you cannot find the information, return exactly: notFound";
    const parts: string[] = [base];
    if (hasWebSearch) {
      parts.push(`You have been given live web search results in the user message (inside the #WEB SEARCH RESULTS block). Rules for using them:
1. Treat the search results as GROUND TRUTH — prefer them over your internal training knowledge.
2. Each result includes Title, URL, Domain (the bare hostname), and Snippet. The Domain field is pre-extracted for you.
3. For domain/URL tasks: read the Domain field of each result first. If a result is the company's own site (not a directory), use that domain.
4. For directory results (gelbeseiten, dasoertliche, 11880, northdata, linkedin, etc.): extract the target company URL from the snippet if present.
5. If results are contradictory, prefer the result whose URL is the company's own homepage over third-party directories.
6. If no result is relevant, fall back to internal knowledge and lower your confidence accordingly.`);
    }
    if (captureReasoning && isJson) {
      parts.push(`Always include a "_reasoning" key in your JSON output. Its value should be a concise 1-3 sentence explanation of: which source(s) you used, why you chose this answer, and what you rejected. Example: "Found hildebrandt-transport.de directly listed on dasoertliche.de snippet. Cross-checked with 11880.com which confirmed the same domain. Rejected linkedin.com as a social profile."`)
    } else if (captureReasoning) {
      parts.push(`Before your answer, output a single line starting with "REASONING:" that briefly states which source you used and why. Then output the answer on the next line.`);
    }
    return parts.join("\n\n");
  }

  // ── Web Search injection ──────────────────────────────────────────────────
  let webSearchContext = "";
  let webSearchSource: string | undefined;
  if (column.useWebSearch && column.searchQuery) {
    try {
      const searchQueryRendered = renderPrompt(column.searchQuery, rowData, column.inputMappings);
      const serpApiKey = process.env.SERP_API_KEY || undefined;
      const searchResp = await webSearch(searchQueryRendered, {
        serpApiKey,
        maxResults: column.searchMaxResults ?? 5,
        forceLayer: column.searchForceLayer,
      });
      webSearchContext = formatSearchResultsForLlm(searchResp);
      webSearchSource = searchResp.source;
    } catch (e) {
      console.warn("[ai] web search failed, continuing without:", (e as Error).message);
    }
  }

  const hasWebSearch = !!(column.useWebSearch && webSearchContext);
  const promptBase = hasWebSearch
    ? `#WEB SEARCH RESULTS (source: ${webSearchSource ?? "web"}):\n${webSearchContext}\n#END WEB SEARCH RESULTS\n\n${column.prompt}`
    : column.prompt;

  const prompt = renderPrompt(promptBase, rowData, column.inputMappings);
  if (!prompt.trim()) return { value: "", error: "Empty prompt after rendering" };

  const maxTokens = column.outputMode === "json" ? 1024 : 512;
  const isJson = column.outputMode === "json";
  const model = column.model || "gpt-4o-mini";

  try {
    let raw = "";
    let tokens: { prompt: number; completion: number; total: number } | undefined;

    const captureReasoning = !!column.captureReasoning;
    const systemMsg = buildSystemMessage(isJson, hasWebSearch, captureReasoning);

    if (provider === "anthropic") {
      const anthropic = await runAnthropicCompletion({ apiKey, model, prompt, isJson: isJson, maxTokens, systemOverride: systemMsg });
      raw = anthropic.raw;
      tokens = anthropic.tokens;
    } else {
      const client = provider === "cerebras"
        ? new OpenAI({
            apiKey,
            baseURL: "https://api.cerebras.ai/v1",
            timeout: 45000,
          })
        : new OpenAI({ apiKey, timeout: 45000 });

      const baseRequest = {
        model,
        messages: [
          { role: "system" as const, content: systemMsg },
          { role: "user" as const, content: prompt },
        ],
      };

      if (provider === "openai" && isOpenAiResponsesOnlyModel(model)) {
        const resp = await client.responses.create({
          model,
          input: [
            { role: "system", content: systemMsg },
            { role: "user", content: prompt },
          ],
          max_output_tokens: maxTokens,
        });
        const usage = resp.usage;
        raw = extractResponsesText(resp);
        tokens = usage
          ? {
              prompt: Number(usage.input_tokens ?? 0),
              completion: Number(usage.output_tokens ?? 0),
              total: Number(usage.total_tokens ?? (Number(usage.input_tokens ?? 0) + Number(usage.output_tokens ?? 0))),
            }
          : undefined;
      } else {
        const resp = await client.chat.completions.create(
          provider === "openai" && isOpenAiReasoningModel(model)
            ? {
                ...baseRequest,
                max_completion_tokens: maxTokens,
              }
            : {
                ...baseRequest,
                max_tokens: maxTokens,
                temperature: 0,
              }
        );
        const usage = resp.usage;
        raw = resp.choices[0]?.message?.content?.trim() ?? "";
        tokens = usage ? { prompt: usage.prompt_tokens ?? 0, completion: usage.completion_tokens ?? 0, total: usage.total_tokens ?? 0 } : undefined;
      }
    }

    console.log(`[LLM] provider=${provider} model=${model} prompt_tokens=${tokens?.prompt} completion_tokens=${tokens?.completion} raw_length=${raw.length} raw_preview=${raw.slice(0,120)}`);
    const costUsd = estimateCostUsd(model, tokens);

    // Extract _reasoning if captureReasoning is enabled (JSON mode);
    // for text mode the REASONING: prefix line is stripped below.
    let reasoningValue: string | undefined;
    if (captureReasoning && isJson) {
      reasoningValue = extractJsonKey(raw, "_reasoning");
      if (reasoningValue === "notFound") reasoningValue = undefined;
    } else if (captureReasoning) {
      const reasoningMatch = raw.match(/^REASONING:\s*(.+?)\n/i);
      if (reasoningMatch) {
        reasoningValue = reasoningMatch[1].trim();
        raw = raw.replace(/^REASONING:\s*.+?\n/i, "").trim();
      }
    }

    // Multi-key mode: write multiple output fields from one JSON response
    if (isJson && column.multiKeys && column.multiKeys.length > 0) {
      const multiValues: Record<string, string> = {};
      for (const mk of column.multiKeys) {
        const extracted = extractJsonKey(raw, mk.jsonKey);
        multiValues[mk.outputKey] = extracted === "notFound" ? "" : extracted;
      }
      if (reasoningValue) multiValues[`_reasoning_${column.outputKey}`] = reasoningValue;

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
      const extra = reasoningValue ? { multiValues: { [`_reasoning_${column.outputKey}`]: reasoningValue } } : {};
      return { value: extracted === "notFound" ? "" : extracted, rawResponse: raw, renderedPrompt: prompt, tokens, costUsd, ...extra };
    }

    const extra = reasoningValue ? { multiValues: { [`_reasoning_${column.outputKey}`]: reasoningValue } } : {};
    return { value: raw === "notFound" ? "" : raw, rawResponse: raw, renderedPrompt: prompt, tokens, costUsd, ...extra };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { value: "", error: message };
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

7. Using web search results:
   - If a #WEB SEARCH RESULTS block is present above your instructions, treat it as live search data.
   - Scan each result's URL and Domain field first — if a result URL IS the company's own homepage (domain matches company name), use that domain directly with confidence "high".
   - Directory listings (dasoertliche.de, gelbeseiten.de, 11880.com, northdata.de, etc.) often contain the company's own website URL in their snippet — extract it from there.
   - Cross-reference at least two results before setting confidence "high".

8. Output rules:
   - Output JSON with camelCase keys only: { "domain": string, "confidence": "high"|"medium"|"low"|"notFound", "sourceUrl": string }
   - Use "high" when the domain is confirmed on the company's homepage and corroborated or clearly unambiguous; "medium" for strong but not fully corroborated matches; "low" when weak signals suggest a match; "notFound" if no reliable domain.
   - For sourceUrl, provide the most authoritative page used (prefer the company homepage or an authoritative directory entry).

#INPUTS#
Company Name: {company_name}
City / Region (if available): {city}
Postal Code (if available): {plz}
Street (if available): {street}
Input URL hint (if available): {input_url}`,
    requiredFields: ["company_name"],
    inputMappings: { company_name: "company_name" },
    condition: "require_input",
    conditionField: "company_name",
    captureReasoning: true,
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
    requiredFields: ["official_domain"],
    inputMappings: { official_domain: "official_domain" },
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
    requiredFields: ["official_domain"],
    inputMappings: { official_domain: "official_domain" },
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
    requiredFields: ["decision_makers_json"],
    inputMappings: { decision_makers_json: "decision_makers_json" },
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
    requiredFields: ["official_domain"],
    inputMappings: { official_domain: "official_domain" },
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

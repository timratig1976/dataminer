import { isOperationCancelled } from "./operations";
import type { AiColumn } from "./types";
import { webSearch, formatSearchResultsForLlm, type SearchLayer, isCatalogUrl } from "./search";
import { normalizeEdenModel, edenChatCompletion, edenScrapeUrl, type EdenRegion } from "./edenai";
import { getCachedScrape, setCachedScrape } from "./db";
import { lookupApolloContacts, ApolloBudget } from "./apollo";
import { batchEnrichRow, BATCH_FIELDS } from "./batch-enrich";
import { searchContacts } from "./contact-search";

/**
 * Eden AI is the ONLY LLM provider. Model IDs use the "provider/model" format
 * served by the OpenAI-compatible /v3 endpoint (one API key for all models).
 * Legacy bare IDs (e.g. "gpt-4o-mini") are auto-normalised to "openai/…".
 */
export const DEFAULT_EDEN_MODEL = "openai/gpt-4o-mini";

/** Kept for metadata/logging compatibility — always "edenai" now. */
export type LlmProvider = "edenai";

export function inferProviderFromModel(_model?: string): LlmProvider {
  return "edenai";
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

// ── Apollo.io tool column ────────────────────────────────────────────────────

function stripDomain(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .toLowerCase()
    .trim();
}

/**
 * Deterministic tool: find contacts for a company via Apollo.io.
 * Uses only the 0-credit search endpoint (never reveal/enrich).
 * Writes a JSON array into column.outputKey.
 */
async function runApolloContactsTool(
  column: AiColumn,
  rowData: Record<string, string | null>,
  budget?: ApolloBudget
): Promise<{ value: string; error?: string; multiValues?: Record<string, string> }> {
  const companyName = String(
    rowData["company_name"] ?? rowData["legal_name"] ?? ""
  ).trim();
  const domain = stripDomain(rowData["official_domain"] ?? rowData["source_domain"] ?? "");

  if (!companyName && !domain) {
    return { value: "", error: "Apollo contacts: company_name or official_domain required" };
  }

  if (!process.env.APOLLO_API_KEY?.trim()) {
    return { value: "", error: "Apollo contacts: APOLLO_API_KEY not configured" };
  }

  try {
    const { contacts, fromCache, transport } = await lookupApolloContacts(
      {
        companyName: companyName || undefined,
        domain: domain || undefined,
        titles: column.toolApolloTitles,
        limit: column.toolApolloLimit ?? 10,
      },
      budget
    );

    if (contacts.length === 0) {
      return {
        value: "",
        multiValues: {
          [column.outputKey]: "",
          [`_apollo_transport_${column.outputKey}`]: fromCache ? "cache" : transport,
          [`_apollo_count_${column.outputKey}`]: "0",
        },
      };
    }

    const serialised = contacts.map((c) => ({
      name: c.name,
      title: c.title ?? "",
      organisation: c.organisation ?? "",
      linkedin: c.linkedinUrl ?? "",
      email_status: c.emailStatus ?? "",
      city: c.city ?? "",
      apollo_id: c.id,
    }));

    const multiValues: Record<string, string> = {
      [column.outputKey]: JSON.stringify(serialised),
      [`_apollo_transport_${column.outputKey}`]: fromCache ? "cache" : transport,
      [`_apollo_count_${column.outputKey}`]: String(contacts.length),
      // convenience: primary contact in separate columns
      [`${column.outputKey}_primary_name`]: contacts[0]?.name ?? "",
      [`${column.outputKey}_primary_title`]: contacts[0]?.title ?? "",
      [`${column.outputKey}_primary_linkedin`]: contacts[0]?.linkedinUrl ?? "",
    };

    return { value: multiValues[column.outputKey], multiValues };
  } catch (e) {
    return { value: "", error: `Apollo contacts: ${(e as Error).message}` };
  }
}

export async function runAiColumn(
  column: AiColumn,
  rowData: Record<string, string | null>,
  apiKey: string,
  provider: LlmProvider = "edenai",
  signal?: AbortSignal,
  operationId?: string,
  edenRegion: EdenRegion = "eu",
  apolloBudget?: ApolloBudget
): Promise<{ value: string; skipped?: boolean; skipReason?: string; error?: string; multiValues?: Record<string, string>; rawResponse?: string; renderedPrompt?: string; tokens?: { prompt: number; completion: number; total: number }; costUsd?: number; webSearchQuery?: string; webSearchResultCount?: number; webSearchSource?: string; scrapedUrls?: string[] }> {
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

  // Apollo.io contacts — deterministic tool column, no LLM, 0-credit search endpoint
  if (column.tool === "apollo_contacts") {
    return await runApolloContactsTool(column, rowData, apolloBudget);
  }

  // ── Batch enrichment — 1 scrape + optional search + 1 LLM call → all fields ──
  if (column.tool === "batch_enrich") {
    const serpApiKey = process.env.SERP_API_KEY || undefined;
    const braveApiKey = process.env.BRAVE_API_KEY || undefined;
    const cachedScrape = await getCachedScrape(
      rowData["domain"] ?? rowData["source_domain"] ?? rowData["source_url"] ?? ""
    ).catch(() => null);

    const result = await batchEnrichRow(rowData as Record<string, string | null>, {
      edenApiKey: apiKey,
      model: normalizeEdenModel(column.model ?? "openai/gpt-4o-mini"),
      serpApiKey,
      braveApiKey,
      requestedFields: column.batchOutputFields ?? [...BATCH_FIELDS],
      searchContacts: column.batchSearchContacts ?? true,
      cachedScrape: cachedScrape?.markdown ?? undefined,
      customSystemPrompt: column.prompt?.trim() || undefined,
      signal,
    });

    if (result.error && Object.keys(result.fields).length === 0) {
      return { value: "", error: result.error };
    }

    // Write all fields to row columns
    const multiValues: Record<string, string> = {};
    for (const [field, val] of Object.entries(result.fields)) {
      multiValues[field] = val ?? "";
    }
    if (result.scrapeMarkdown) {
      const url = rowData["source_url"] ?? rowData["domain"] ?? "";
      if (url) setCachedScrape(url, result.scrapeMarkdown, "").catch(() => null);
    }
    // Store debug info for detail modal
    if (result.debugPrompt) multiValues[`_llm_prompt_${column.outputKey}`] = result.debugPrompt;
    if (result.debugRawResponse) multiValues[`_llm_raw_${column.outputKey}`] = result.debugRawResponse;
    if (result.scrapeError) multiValues[`_batch_scrape_error_${column.outputKey}`] = result.scrapeError;
    if (result.searchError) multiValues[`_batch_search_error_${column.outputKey}`] = result.searchError;
    if (result.sourcesUsed) multiValues[`_batch_sources_${column.outputKey}`] = result.sourcesUsed.join(", ");
    if (result.tokensUsed) multiValues[`_llm_tokens_${column.outputKey}`] = JSON.stringify({ prompt: 0, completion: 0, total: result.tokensUsed });
    if (result.costUsd !== undefined) multiValues[`_llm_cost_${column.outputKey}`] = String(result.costUsd);

    // Primary output key gets a summary
    const filledCount = Object.values(result.fields).filter(v => v && v !== "null").length;
    const summaryValue = `${filledCount}/${Object.keys(result.fields).length} Felder angereichert`;

    return {
      value: summaryValue,
      multiValues,
      tokens: result.tokensUsed ? { prompt: 0, completion: 0, total: result.tokensUsed } : undefined,
      costUsd: result.costUsd,
      error: result.error,
    };
  }

  // ── Contact search — Impressum + LinkedIn + Google → Entscheider ──────────
  if (column.tool === "batch_contacts") {
    const serpApiKey = process.env.SERP_API_KEY || undefined;
    const braveApiKey = process.env.BRAVE_API_KEY || undefined;
    const maxContacts = column.batchContactsMax ?? 3;
    const prefix = column.batchContactsPrefix ?? "contact_";

    const result = await searchContacts(rowData as Record<string, string | null>, {
      edenApiKey: apiKey,
      model: normalizeEdenModel(column.model ?? "openai/gpt-4o-mini"),
      serpApiKey,
      braveApiKey,
      maxContacts,
      scrapeImpressum: column.batchContactsImpressum ?? true,
      searchLinkedIn: column.batchContactsLinkedIn ?? true,
      signal,
    });

    if (result.error && result.contacts.length === 0) {
      return { value: "", error: result.error };
    }

    // Write contacts as flat fields: contact_1_first_name, contact_1_last_name, etc.
    // Also write primary contact directly into standard fields if they're empty
    const multiValues: Record<string, string> = {};

    // Primary contact → write into first_name, last_name, position if empty
    const primary = result.contacts[0];
    if (primary) {
      // Always write to indexed fields
      multiValues[`${prefix}1_first_name`] = primary.first_name ?? "";
      multiValues[`${prefix}1_last_name`] = primary.last_name ?? "";
      multiValues[`${prefix}1_position`] = primary.position ?? "";
      multiValues[`${prefix}1_email`] = primary.email ?? "";
      multiValues[`${prefix}1_phone`] = primary.phone ?? "";
      multiValues[`${prefix}1_linkedin`] = primary.linkedin ?? "";

      // Also write into standard flat fields (if not already set by batch_enrich)
      if (!rowData["first_name"] || rowData["first_name"] === "") multiValues["first_name"] = primary.first_name ?? "";
      if (!rowData["last_name"] || rowData["last_name"] === "") multiValues["last_name"] = primary.last_name ?? "";
      if (!rowData["position"] || rowData["position"] === "") multiValues["position"] = primary.position ?? "";
      if (primary.email) multiValues["contact_email"] = primary.email;
      if (primary.phone) multiValues["contact_phone"] = primary.phone;
      if (primary.linkedin) multiValues["linkedin"] = primary.linkedin;
    }

    // Additional contacts
    for (let i = 1; i < result.contacts.length; i++) {
      const c = result.contacts[i];
      const n = i + 1;
      multiValues[`${prefix}${n}_first_name`] = c.first_name ?? "";
      multiValues[`${prefix}${n}_last_name`] = c.last_name ?? "";
      multiValues[`${prefix}${n}_position`] = c.position ?? "";
      multiValues[`${prefix}${n}_email`] = c.email ?? "";
      multiValues[`${prefix}${n}_phone`] = c.phone ?? "";
      multiValues[`${prefix}${n}_linkedin`] = c.linkedin ?? "";
    }

    // JSON summary in outputKey — structured for detail modal and sub-table display
    const contactsJson = JSON.stringify(result.contacts.map(c => ({
      first_name: c.first_name,
      last_name: c.last_name,
      position: c.position,
      email: c.email,
      phone: c.phone,
      linkedin: c.linkedin,
      source: c.source,
    })));

    // Human-readable summary for table cell display
    const summaryText = result.contacts.length > 0
      ? result.contacts.map(c =>
          [c.first_name, c.last_name].filter(Boolean).join(" ") +
          (c.position ? ` (${c.position})` : "") +
          (c.email ? ` · ${c.email}` : "")
        ).join("\n")
      : "";

    // Debug info
    multiValues[`_contacts_sources_${column.outputKey}`] = result.sourcesUsed.join(", ");
    multiValues[`_contacts_json_${column.outputKey}`] = contactsJson;
    // Standard meta fields so the detail modal can pick them up
    if (result.tokensUsed) multiValues[`_llm_tokens_${column.outputKey}`] = JSON.stringify({ prompt: 0, completion: 0, total: result.tokensUsed });
    if (result.costUsd !== undefined) multiValues[`_llm_cost_${column.outputKey}`] = String(result.costUsd);
    // Full prompt + raw LLM response stored under standard keys
    if (result.debugPrompt) multiValues[`_llm_prompt_${column.outputKey}`] = result.debugPrompt;
    if (result.debugRawResponse) multiValues[`_llm_raw_${column.outputKey}`] = result.debugRawResponse;
    // Source URLs
    if (result.sourceUrls?.length) multiValues[`_contacts_source_urls_${column.outputKey}`] = result.sourceUrls.join("\n");

    return {
      value: summaryText || contactsJson,
      multiValues: { [column.outputKey]: summaryText, ...multiValues },
      tokens: result.tokensUsed ? { prompt: 0, completion: 0, total: result.tokensUsed } : undefined,
      costUsd: result.costUsd,
    };
  }

  // ── System message builder ─────────────────────────────────────────────────
  function buildSystemMessage(isJson: boolean, hasWebSearch: boolean, captureReasoning: boolean, hasPageContent = false): string {
    const base = isJson
      ? "You are a data enrichment assistant. Return ONLY valid JSON, no markdown, no explanation."
      : "You are a data enrichment assistant. Return only the requested value, nothing else. If you cannot find the information, return exactly: notFound";
    const parts: string[] = [base];
    if (hasPageContent) {
      parts.push(`You have been given the full text content of relevant web pages in the user message (inside the #PAGE CONTENT block). Rules for using it:
1. Treat page content as PRIMARY evidence — it is the actual site text and is more reliable than search snippets or your training knowledge.
2. Extract the requested value directly from the page content (e.g. Impressum, About, Contact, footer sections).
3. If page content contradicts search snippets, prefer the page content.
4. If the information is not present in the provided pages or snippets, return notFound rather than guessing.`);
    }
    if (hasWebSearch) {
      parts.push(`You have been given live web search results in the user message (inside the #WEB SEARCH RESULTS block). Rules for using them:
1. Treat the search results as GROUND TRUTH — prefer them over your internal training knowledge.
2. Each result includes Title, URL, Domain (the bare hostname), and Snippet. The Domain field is pre-extracted for you.
3. For domain/URL tasks: read the Domain field of each result first. If a result is the company's own site (not a directory), use that domain.
4. For directory results (gelbeseiten, dasoertliche, 11880, northdata, wlw, kompass, europages, cylex, linkedin, xing, etc.): extract the target company URL from the snippet if present — do NOT use the directory URL itself as the answer.
5. If results are contradictory, prefer the result whose URL is the company's own homepage over third-party directories.
6. NEVER output a catalog, directory, social, or review domain as the final domain answer. These are NEVER valid company websites: wlw.de, gelbeseiten.de, dasoertliche.de, 11880.com, northdata.de, kompass.com, europages.de, cylex.de, linkedin.com, xing.com, facebook.com, yelp.com, trustpilot.com, kununu.com, glassdoor.com, wikipedia.org, bloomberg.com, crunchbase.com.
7. If a city is provided in the inputs: a candidate domain must be verifiably associated with that city. A shared abbreviation or partial name match is NOT enough — the snippet or site content must confirm the city. If uncertain, lower confidence to "low" or "notFound".
8. If no result contains the company's own homepage, return confidence "notFound" rather than a directory URL.`);
    }
    if (captureReasoning && isJson) {
      parts.push(`Always include a "_reasoning" key in your JSON output. Its value should be a concise 1-3 sentence explanation of: which source(s) you used, why you chose this answer, and what you rejected. Example: "Found hildebrandt-transport.de directly listed on dasoertliche.de snippet. Cross-checked with 11880.com which confirmed the same domain. Rejected linkedin.com as a social profile."`)
    } else if (captureReasoning) {
      parts.push(`Before your answer, output a single line starting with "REASONING:" that briefly states which source you used and why. Then output the answer on the next line.`);
    }
    return parts.join("\n\n");
  }

  // ── Web Search + Page Evidence injection ─────────────────────────────────
  let webSearchContext = "";
  let webSearchSource: string | undefined;
  let webSearchResultCount = 0;
  let webSearchQueryRendered: string | undefined;
  let pageContext = "";
  let scrapedUrls: string[] = [];
  let searchResults: { title: string; url: string; snippet: string }[] = [];
  const evidenceMode = column.evidenceMode ?? "snippet";
  // Firecrawl uses the same single Eden key as the LLM
  const firecrawlKey = apiKey || process.env.EDEN_API_KEY || undefined;

  // Resolve city value directly from rowData (via inputMappings or common field names)
  function resolveCity(): string {
    const cityKeys = ["city", "Stadt", "stadt", "Ort", "ort", "location", "Location"];
    if (column.inputMappings) {
      for (const [placeholder, sourceKey] of Object.entries(column.inputMappings)) {
        if (/city|stadt|ort/i.test(placeholder) || /city|stadt|ort/i.test(sourceKey)) {
          const v = rowData[sourceKey];
          if (v && v.trim() && v.trim() !== "(not provided)") return v.trim();
        }
      }
    }
    for (const k of cityKeys) {
      const v = rowData[k];
      if (v && v.trim() && v.trim() !== "(not provided)") return v.trim();
    }
    return "";
  }

  // Build fallback queries: strip legal form suffixes, then drop trailing words
  function buildFallbacks(q: string, city: string): string[] {
    const noLegal = q.replace(/\b(GmbH|AG|KG|UG|e\.K\.|eG|GbR|OHG|mbH|Co\.|&\s*Co\.?|KGaA|SE|Ltd\.?|Inc\.?|LLC)\b\.?/gi, "").replace(/\s{2,}/g, " ").trim();
    const noPlaceholder = noLegal.replace(/\(not provided\)/gi, "").replace(/\s{2,}/g, " ").trim();
    const words = noPlaceholder.split(/\s+/);
    const shorterForms: string[] = [];
    for (let i = words.length - 1; i >= 2; i--) {
      shorterForms.push(words.slice(0, i).join(" "));
    }
    const cityPinned = city && shorterForms.length > 0
      ? [`${shorterForms[0]} "${city}"`]
      : [];
    return [...cityPinned, noPlaceholder, ...shorterForms].filter((q2, i, arr) => q2 && arr.indexOf(q2) === i && q2 !== q);
  }

  // Run the search (primary query + fallbacks) and return raw results
  async function doSearch(): Promise<{ results: typeof searchResults; source: SearchLayer; query: string }> {
    const primaryQuery = renderPrompt(column.searchQuery!, rowData, column.inputMappings);
    const serpApiKey = process.env.SERP_API_KEY || undefined;
    const braveApiKey = process.env.BRAVE_API_KEY || undefined;
    const scraplingUrl = process.env.SCRAPLING_URL || undefined;
    const scraplingToken = process.env.SCRAPLING_TOKEN || undefined;
    const firecrawlApiKey = apiKey || process.env.EDEN_API_KEY || undefined;
    const searchOpts = { serpApiKey, braveApiKey, scraplingUrl, scraplingToken, firecrawlApiKey, maxResults: column.searchMaxResults ?? 5, forceLayer: column.searchForceLayer };

    const resolvedCity = resolveCity();
    let effectivePrimary = primaryQuery;
    if (resolvedCity && !primaryQuery.includes(`"${resolvedCity}"`)) {
      effectivePrimary = primaryQuery.replace(
        new RegExp(`\\b${resolvedCity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"),
        `"${resolvedCity}"`
      );
    }

    let resp = await webSearch(effectivePrimary, searchOpts);
    if (resp.results.length === 0) {
      for (const fallback of buildFallbacks(primaryQuery, resolvedCity)) {
        console.log(`[ai] 0 results for "${effectivePrimary}", retrying with "${fallback}"`);
        resp = await webSearch(fallback, searchOpts);
        if (resp.results.length > 0) {
          effectivePrimary = fallback;
          break;
        }
      }
    }
    webSearchQueryRendered = effectivePrimary;
    return { results: resp.results, source: resp.source, query: effectivePrimary };
  }

  // Scrape the top non-catalog result URLs into a #PAGE CONTENT block.
  // Uses the local scrape cache (7-day TTL) to avoid re-paying Firecrawl for
  // URLs we already fetched (common in bulk runs / re-runs).
  async function scrapeTopPages(urls: string[], maxPages = 2, maxCharsEach = 15000): Promise<string> {
    const candidates = urls.filter((u) => u.startsWith("http") && !isCatalogUrl(u)).slice(0, maxPages);
    if (candidates.length === 0) return "";
    const blocks: string[] = [];
    let cacheHits = 0;
    for (const url of candidates) {
      if (operationId && isOperationCancelled(operationId)) throw new Error("Operation cancelled");
      try {
        const cached = await getCachedScrape(url);
        let { markdown, title } = cached ?? {};
        if (!markdown) {
          ({ markdown, title } = await edenScrapeUrl({ apiKey: firecrawlKey!, url }));
          if (markdown && markdown.trim()) await setCachedScrape(url, markdown, title);
        } else {
          cacheHits++;
        }
        if (markdown && markdown.trim()) {
          blocks.push(`### ${title || url}\nURL: ${url}\n${markdown.slice(0, maxCharsEach)}`);
        }
      } catch (e) {
        console.warn(`[ai] page scrape failed for ${url}:`, (e as Error).message);
      }
    }
    if (cacheHits > 0) console.log(`[ai] scrape cache: ${cacheHits}/${candidates.length} hit(s)`);
    return blocks.join("\n\n---\n\n");
  }

  if (column.useWebSearch && column.searchQuery) {
    // Check cancellation before expensive web search
    if (operationId && isOperationCancelled(operationId)) {
      throw new Error("Operation cancelled");
    }
    try {
      const s = await doSearch();
      searchResults = s.results;
      webSearchContext = formatSearchResultsForLlm({ results: s.results, source: s.source, query: s.query, latencyMs: 0 });
      webSearchSource = s.source;
      webSearchResultCount = s.results.length;

      if (evidenceMode === "page" || evidenceMode === "auto") {
        pageContext = await scrapeTopPages(s.results.map((r) => r.url));
        scrapedUrls = s.results.map((r) => r.url).filter((u) => u.startsWith("http") && !isCatalogUrl(u)).slice(0, 2);
      }
    } catch (e) {
      console.warn("[ai] web search failed, continuing without:", (e as Error).message);
    }
  }

  const hasWebSearch = !!(column.useWebSearch && webSearchContext);
  let hasPageContent = !!pageContext;
  const promptBase = [
    hasWebSearch ? `#WEB SEARCH RESULTS (source: ${webSearchSource ?? "web"}):\n${webSearchContext}\n#END WEB SEARCH RESULTS` : "",
    hasPageContent ? `#PAGE CONTENT (scraped full pages):\n${pageContext}\n#END PAGE CONTENT` : "",
    column.prompt,
  ].filter(Boolean).join("\n\n");

  const maxTokens = column.outputMode === "json" ? 1024 : 512;
  const isJson = column.outputMode === "json";
  // Bare legacy IDs (e.g. "gpt-4o-mini") are normalised to Eden "provider/model" format
  const model = column.tool ? (column.model || "") : normalizeEdenModel(column.model || DEFAULT_EDEN_MODEL);

  // ── LLM call via Eden AI (with one "auto" retry using scraped pages if the first pass is empty)
  let raw = "";
  let tokens: { prompt: number; completion: number; total: number } | undefined;
  let costUsdOverride: number | undefined;
  let prompt = "";

  function llmCall(p: string, sys: string) {
    return edenChatCompletion({
      apiKey,
      region: edenRegion,
      model,
      system: sys,
      prompt: p,
      maxTokens,
      reasoning: column.reasoning,
      signal,
    }).then((r) => ({ raw: r.raw, tokens: r.tokens, cost: r.costUsd }));
  }

  try {
    const captureReasoning = !!column.captureReasoning;

    // Check cancellation before expensive LLM call
    if (operationId && isOperationCancelled(operationId)) {
      throw new Error("Operation cancelled");
    }

    {
      const systemMsg = buildSystemMessage(isJson, hasWebSearch, captureReasoning, hasPageContent);
      prompt = renderPrompt(promptBase, rowData, column.inputMappings);
      if (!prompt.trim()) return { value: "", error: "Empty prompt after rendering" };
      const first = await llmCall(prompt, systemMsg);
      raw = first.raw;
      tokens = first.tokens;
      if (first.cost !== undefined) costUsdOverride = first.cost;

      // "auto" mode: if the answer is empty and we haven't scraped pages yet,
      // scrape the top results and retry once with full page content.
      if (evidenceMode === "auto" && !hasPageContent && firecrawlKey && searchResults.length > 0) {
        const answerEmpty = raw.trim() === "" || /^notfound$/i.test(raw.trim()) || (isJson && (raw.includes('"notFound"') || !raw.trim().startsWith("{")));
        if (answerEmpty) {
          console.log(`[ai] auto mode: empty answer, scraping top pages and retrying`);
          pageContext = await scrapeTopPages(searchResults.map((r) => r.url));
          scrapedUrls = searchResults.map((r) => r.url).filter((u) => u.startsWith("http") && !isCatalogUrl(u)).slice(0, 2);
          if (pageContext) {
            hasPageContent = true;
            const retryBase = [
              `#WEB SEARCH RESULTS (source: ${webSearchSource ?? "web"}):\n${webSearchContext}\n#END WEB SEARCH RESULTS`,
              `#PAGE CONTENT (scraped full pages):\n${pageContext}\n#END PAGE CONTENT`,
              column.prompt,
            ].filter(Boolean).join("\n\n");
            const retrySystem = buildSystemMessage(isJson, hasWebSearch, captureReasoning, true);
            prompt = renderPrompt(retryBase, rowData, column.inputMappings);
            const second = await llmCall(prompt, retrySystem);
            raw = second.raw;
            tokens = second.tokens;
            if (second.cost !== undefined) costUsdOverride = second.cost;
          }
        }
      }
    }

    console.log(`[LLM] provider=${provider} model=${model} prompt_tokens=${tokens?.prompt} completion_tokens=${tokens?.completion} raw_length=${raw.length} raw_preview=${raw.slice(0,120)}`);
    const costUsd = costUsdOverride ?? estimateCostUsd(model, tokens);

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
        webSearchQuery: webSearchQueryRendered,
        webSearchResultCount,
        webSearchSource,
        ...(scrapedUrls.length ? { scrapedUrls } : {}),
      };
    }

    if (isJson && column.jsonKey) {
      const extracted = extractJsonKey(raw, column.jsonKey);
      const extra = reasoningValue ? { multiValues: { [`_reasoning_${column.outputKey}`]: reasoningValue } } : {};
      return { value: extracted === "notFound" ? "" : extracted, rawResponse: raw, renderedPrompt: prompt, tokens, costUsd, webSearchQuery: webSearchQueryRendered, webSearchResultCount, webSearchSource, ...(scrapedUrls.length ? { scrapedUrls } : {}), ...extra };
    }

    const extra = reasoningValue ? { multiValues: { [`_reasoning_${column.outputKey}`]: reasoningValue } } : {};
    return { value: raw === "notFound" ? "" : raw, rawResponse: raw, renderedPrompt: prompt, tokens, costUsd, webSearchQuery: webSearchQueryRendered, webSearchResultCount, webSearchSource, ...(scrapedUrls.length ? { scrapedUrls } : {}), ...extra };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { value: "", error: message };
  }
}

export const DEFAULT_PRESETS: Omit<AiColumn, "id">[] = [
  {
    name: "Official Domain",
    outputKey: "official_domain",
    model: "openai/gpt-4o-mini",
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

7. CITY VERIFICATION (critical — do this before finalising):
   - If City is provided and not "(not provided)": you MUST verify the candidate domain belongs to the correct company in that city.
   - Check the snippet or the domain name itself for a city match. If the snippet mentions a different city or the domain is clearly a different company, REJECT it.
   - A domain that shares only the abbreviation or first word of the company name (e.g. "ITU") is NOT sufficient — the full name + city must match.
   - If you cannot confirm the city matches, set confidence to "low" or "notFound". Never set "high" without city confirmation when city is provided.
   - Example: company "ITU Matuscheck" in Luckenwalde → reject itu-gmbh.de if that company is based elsewhere.

8. Using web search results:
   - If a #WEB SEARCH RESULTS block is present above your instructions, treat it as live search data.
   - Scan each result's URL and Domain field first — if a result URL IS the company's own homepage (domain matches company name AND city), use that domain.
   - Directory listings (dasoertliche.de, gelbeseiten.de, 11880.com, northdata.de, etc.) often contain the company's own website URL in their snippet — extract it from there.
   - Cross-reference at least two results before setting confidence "high".

9. Output rules:
   - Output JSON with camelCase keys only: { "domain": string, "confidence": "high"|"medium"|"low"|"notFound", "sourceUrl": string, "_reasoning": string }
   - Use "high" ONLY when name AND city are both confirmed; "medium" for plausible but unverified city; "low" when weak signals; "notFound" if no reliable match.
   - For sourceUrl, provide the most authoritative page used (prefer the company homepage or an authoritative directory entry).
   - For _reasoning: Provide a concise 2-3 sentence explanation in this format:
     * "Selected [domain] because [brief justification]. Rejected [alternatives] because [reason]. Confidence: [confidence level]."
     * Example: "Selected sd-gmbh.de because company name and Berlin location match search results. Rejected other results as different entities. Confidence: medium (city not explicitly confirmed)."

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
    model: "openai/gpt-4o-mini",
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
    model: "openai/gpt-4o-mini",
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
    model: "openai/gpt-4o-mini",
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
    model: "openai/gpt-4o-mini",
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
    model: "openai/gpt-4o-mini",
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
    model: "openai/gpt-4o-mini",
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
    model: "openai/gpt-4o-mini",
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
    model: "openai/gpt-4o-mini",
    outputMode: "text",
    prompt: `Find the city and postal code (PLZ) of the headquarters of this company.
Company: {company_name}
Website: {official_domain}

Return ONLY in format: PLZ City (e.g. 80331 München). If not found, return: notFound`,
    condition: "empty",
    conditionField: "city",
  },
  {
    name: "Impressum / Firmendaten",
    outputKey: "address",
    model: "openai/gpt-4o-mini",
    outputMode: "json",
    multiKeys: [
      { jsonKey: "address", outputKey: "address" },
      { jsonKey: "legal_name", outputKey: "legal_name" },
      { jsonKey: "phone", outputKey: "phone" },
      { jsonKey: "email", outputKey: "impressum_email" },
      { jsonKey: "managing_director", outputKey: "managing_director" },
      { jsonKey: "ust_id", outputKey: "ust_id" },
    ],
    useWebSearch: true,
    searchQuery: "{company_name} {official_domain} impressum",
    evidenceMode: "page",
    requiredFields: ["company_name"],
    inputMappings: { company_name: "company_name", official_domain: "official_domain" },
    condition: "empty",
    conditionField: "address",
    prompt: `#CONTEXT#
You are a German business data researcher. The user message contains web search results and — when available — the full text of the company's website pages (look for the Impressum section).
#OBJECTIVE#
Extract the company's official registration data from its Impressum (or, if no Impressum is present, from Contact/About/company-info pages).

#INSTRUCTIONS#
1. Prefer the official Impressum content of the company's own website over third-party directories.
2. Extract the following fields exactly as written on the page:
   - legal_name: the full legal company name (e.g. "Ostsee Fisch GmbH & Co. Produktions- und Vertriebs KG")
   - address: the complete postal address on one line (street, PLZ, city)
   - phone: the main phone number (keep country code, e.g. +49 ...)
   - email: the primary contact email
   - managing_director: name(s) of the managing director(s) (Geschäftsführer)
   - ust_id: the USt-IdNr / VAT ID (e.g. DE123456789)
3. If a field is not present in the provided content, use "notFound" for that field.
4. NEVER guess or invent data. Only extract what is actually in the provided page content or snippets.
5. Ignore data from other companies that may appear in the same page (e.g. parent companies, subsidiaries, web agencies).

Return ONLY valid JSON with the keys: legal_name, address, phone, email, managing_director, ust_id, _reasoning`,
  },
  {
    name: "Apollo Contacts",
    outputKey: "apollo_contacts",
    model: "apollo-tool",
    tool: "apollo_contacts",
    toolApolloLimit: 10,
    outputMode: "json",
    prompt: "", // deterministic tool — no LLM prompt
    condition: "empty",
    conditionField: "apollo_contacts",
  },
  // ── Batch enrichment preset — replaces 6-8 individual column calls ──────
  {
    name: "🚀 Alles auf einmal anreichern",
    outputKey: "_batch_status",
    model: "openai/gpt-4o-mini",
    tool: "batch_enrich",
    batchOutputFields: ["company_name", "domain", "phone", "email", "city", "zip", "industry", "description", "first_name", "last_name", "position"],
    batchSearchContacts: true,
    prompt: "",
    condition: "empty",
    conditionField: "_batch_status",
    outputMode: "text",
  },
  // ── Contact search preset ─────────────────────────────────────────────────
  {
    name: "👤 Kontakte & Entscheider finden",
    outputKey: "contacts",
    model: "openai/gpt-4o-mini",
    tool: "batch_contacts",
    batchContactsMax: 3,
    batchContactsLinkedIn: true,
    batchContactsImpressum: true,
    batchContactsPrefix: "contact_",
    prompt: "",
    condition: "empty",
    conditionField: "contacts",
    outputMode: "text",
  },
];

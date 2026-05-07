import OpenAI from "openai";
import type { AiColumn } from "./types";

function renderPrompt(template: string, data: Record<string, string | null>): string {
  return template.replace(/\{([^}]+)\}/g, (_, key) => {
    const val = data[key.trim()];
    return val != null ? String(val) : "";
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

      const html = (await res.text()).toLowerCase().slice(0, 8000);
      const keywords = companyName.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      const matched = keywords.some((kw) => html.includes(kw));
      return {
        valid: matched,
        reason: matched ? "HTTP OK + brand match" : "HTTP OK but no brand match",
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
): Promise<{ value: string; skipped?: boolean; skipReason?: string; error?: string }> {
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

  try {
    const client = new OpenAI({ apiKey, timeout: 30000 });
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
      max_tokens: 256,
      temperature: 0,
    });
    const raw = resp.choices[0]?.message?.content?.trim() ?? "";

    if (isJson && column.jsonKey) {
      const extracted = extractJsonKey(raw, column.jsonKey);
      return { value: extracted === "notFound" ? "" : extracted };
    }

    return { value: raw === "notFound" ? "" : raw };
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
    prompt: `Find the official primary domain for company '{company_name}'.
Input URL hint: {input_url}
If not clearly verifiable from authoritative sources, return notFound with empty domain.
Return strict JSON only: {"domain":"","confidence":"high|medium|low|notFound","sourceUrl":""}`,
    condition: "empty",
    conditionField: "official_domain",
  },
  {
    name: "Domain Confidence",
    outputKey: "domain_confidence",
    model: "gpt-4o-mini",
    outputMode: "json",
    jsonKey: "confidence",
    prompt: `Find the official primary domain for company '{company_name}'.
Input URL hint: {input_url}
If not clearly verifiable from authoritative sources, return notFound with empty domain.
Return strict JSON only: {"domain":"","confidence":"high|medium|low|notFound","sourceUrl":""}`,
    condition: "empty",
    conditionField: "domain_confidence",
  },
  {
    name: "Domain Source URL",
    outputKey: "domain_source_url",
    model: "gpt-4o-mini",
    outputMode: "json",
    jsonKey: "sourceUrl",
    prompt: `Find the official primary domain for company '{company_name}'.
Input URL hint: {input_url}
If not clearly verifiable from authoritative sources, return notFound with empty domain.
Return strict JSON only: {"domain":"","confidence":"high|medium|low|notFound","sourceUrl":""}`,
    condition: "empty",
    conditionField: "domain_source_url",
  },
  {
    name: "Domain Validated",
    outputKey: "official_domain_validated",
    model: "validator",
    outputMode: "text",
    prompt: "",
    condition: "not_empty",
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
    name: "Managing Director",
    outputKey: "managing_director",
    model: "gpt-4o-mini",
    outputMode: "text",
    prompt: `Find the managing director or CEO of this company.
Company: {company_name}
Website: {official_domain}

Return ONLY the full name. Multiple directors separated by comma. If not found, return: notFound`,
    condition: "empty",
    conditionField: "managing_director",
  },
  {
    name: "Industry",
    outputKey: "industry",
    model: "gpt-4o-mini",
    outputMode: "text",
    prompt: `Classify the industry/sector of this company in 2-4 German keywords.
Company: {company_name}
Website: {official_domain}

Return ONLY the keywords separated by commas. If unknown, return: notFound`,
    condition: "empty",
    conditionField: "industry",
  },
  {
    name: "LinkedIn",
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

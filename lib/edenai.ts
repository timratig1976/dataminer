/**
 * lib/edenai.ts
 * Eden AI gateway client (v3).
 *
 * Endpoints (verified 2026-08):
 *   GET  {base}/v3/models           → { data: [{ id, owned_by, model_name, context_length, capabilities, pricing, regions }] }
 *   POST {base}/v3/chat/completions → OpenAI-compatible (model: "provider/model")
 *   POST {base}/v3/universal-ai     → { status, cost, output } (model: "feature/subfeature/provider[/model]")
 *
 * Regions:
 *   eu → https://api.eu.edenai.run   (EU data residency; auto-filters EU-eligible providers)
 *   us → https://api.edenai.run      (global; Firecrawl web features are US-only)
 */

export type EdenRegion = "eu" | "us";

export const EDEN_BASE_URLS: Record<EdenRegion, string> = {
  eu: "https://api.eu.edenai.run",
  us: "https://api.edenai.run",
};

export function edenBaseUrl(region?: string | null): string {
  return region === "us" ? EDEN_BASE_URLS.us : EDEN_BASE_URLS.eu;
}

/** True if a model string is an Eden AI model (provider/model format). */
export function isEdenModel(model?: string | null): boolean {
  return !!model && model.includes("/") && !model.startsWith("http");
}

export function edenProviderOf(model: string): string {
  return model.split("/")[0] || "unknown";
}

/**
 * Normalise a model ID to Eden's "provider/model" format.
 * Legacy bare IDs from the old multi-provider era are mapped to their
 * Eden provider prefix (e.g. "gpt-4o-mini" → "openai/gpt-4o-mini",
 * "claude-3-5-haiku-20241022" → "anthropic/claude-3-5-haiku-20241022",
 * "llama3.3-70b" → "meta/llama3.3-70b"). IDs that already contain a
 * provider prefix are returned unchanged. Special non-LLM markers
 * ("validator", "apollo-tool") are returned unchanged.
 */
export function normalizeEdenModel(model: string): string {
  if (!model || model.includes("/")) return model;
  if (model === "validator" || model === "apollo-tool") return model;
  const m = model.toLowerCase();
  if (m.startsWith("claude")) return `anthropic/${model}`;
  if (m.startsWith("gemini")) return `google/${model}`;
  if (m.startsWith("mistral") || m.startsWith("codestral") || m.startsWith("mixtral")) return `mistral/${model}`;
  if (m.startsWith("llama") || m.startsWith("gpt-oss") || m.startsWith("qwen") || m.startsWith("deepseek") || m.startsWith("kimi") || m.startsWith("minimax") || m.startsWith("glm") || m.startsWith("zai")) {
    return `meta/${model}`;
  }
  // default: OpenAI family on Eden
  return `openai/${model}`;
}

export type ReasoningEffort = "none" | "low" | "medium" | "high";

/** OpenAI reasoning models (o-series, gpt-5.x) — mirrors contentor's detection. */
export function isOpenAiReasoningModel(model: string): boolean {
  return /\b(o1|o3|o4|gpt-5)/.test(model.toLowerCase());
}

/**
 * Provider-specific reasoning params for Eden v3 chat/completions
 * (pattern adopted from the contentor project's EdenAIChatGenerator):
 *  - anthropic   → output_config.effort
 *  - openai/azure o-series|gpt-5 → reasoning_effort
 *  - google      → thinking_config.thinking_budget
 *  - others      → ignored
 */
export function reasoningParams(model: string, reasoning?: ReasoningEffort): Record<string, unknown> {
  const level = (reasoning ?? "none").toLowerCase();
  if (level !== "low" && level !== "medium" && level !== "high") return {};
  const provider = edenProviderOf(model);
  const cleanModel = model.slice(provider.length + 1);
  if (provider === "anthropic") {
    return { output_config: { effort: level } };
  }
  if ((provider === "openai" || provider === "azure") && isOpenAiReasoningModel(cleanModel)) {
    return { reasoning_effort: level };
  }
  if (provider === "google") {
    const budgets: Record<string, number> = { low: 128, medium: 1024, high: 4096 };
    return { thinking_config: { thinking_budget: budgets[level] } };
  }
  return {};
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface EdenModelInfo {
  id: string;              // "provider/model" — usable directly as the `model` field
  provider: string;        // owned_by
  model_name: string;
  context_length?: number;
  capabilities?: {
    input_modalities?: string[];
    output_modalities?: string[];
    supports_reasoning?: boolean;
    supports_web_search?: boolean;
    supports_system_messages?: boolean;
    supports_response_schema?: boolean;
    supports_function_calling?: boolean;
  } | null;
  pricing?: { input_cost_per_token?: number; output_cost_per_token?: number };
  regions?: Array<{ code: string; name?: string }>;
}

export interface EdenChatResult {
  raw: string;
  tokens?: { prompt: number; completion: number; total: number };
  costUsd?: number;
  model?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function edenFetch(url: string, apiKey: string, init: RequestInit, timeoutMs = 60_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Eden AI timeout after ${timeoutMs}ms`)), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: init.signal ?? controller.signal,
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function edenError(json: any, status: number): Error {
  const msg =
    json?.error?.message ||
    json?.detail?.message ||
    (typeof json?.detail === "string" ? json.detail : "") ||
    json?.error?.type ||
    `HTTP ${status}`;
  return new Error(msg);
}

/** True for transient timeouts/aborts or rate-limits that are worth a retry. */
function isRetryable(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /timeout|abort|ECONNRESET|ETIMEDOUT|fetch failed|socket|rate limit|too many requests|429/i.test(m);
}

/**
 * Run `fn` once, and retry on transient timeout, rate limit or abort.
 * Absorbs rate limits (e.g. Firecrawl 429) and cold-start spikes on Eden's US universal-ai gateway.
 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, initialDelayMs = 1500): Promise<T> {
  let attempt = 0;
  let delay = initialDelayMs;
  while (true) {
    try {
      return await fn();
    } catch (e) {
      attempt++;
      if (attempt > maxRetries || !isRetryable(e)) throw e;
      const m = e instanceof Error ? e.message : String(e);
      const isRateLimit = /rate limit|too many requests|429/i.test(m);
      const waitMs = isRateLimit ? Math.max(delay, 2000) : delay;
      await new Promise((r) => setTimeout(r, waitMs + Math.floor(Math.random() * 500)));
      delay *= 2;
    }
  }
}

// ── Model discovery ──────────────────────────────────────────────────────────

export async function listEdenModels(
  region: EdenRegion = "eu",
  apiKey?: string,
  opts: { onlyTextChat?: boolean } = {}
): Promise<EdenModelInfo[]> {
  const base = edenBaseUrl(region);
  const headers: Record<string, string> = {};
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const res = await fetch(`${base}/v3/models`, { headers, signal: AbortSignal.timeout(30_000) });
  const json = await res.json();
  if (!res.ok) throw edenError(json, res.status);

  const data: any[] = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : [];
  let models: EdenModelInfo[] = data
    .filter((m) => typeof m?.id === "string" && m.id.includes("/"))
    .map((m) => ({
      id: m.id,
      provider: m.owned_by ?? m.id.split("/")[0],
      model_name: m.model_name ?? m.id,
      context_length: m.context_length,
      capabilities: m.capabilities ?? null,
      pricing: m.pricing ?? m.list_pricing,
      regions: m.regions,
    }));

  if (opts.onlyTextChat !== false) {
    // Keep models that can at least accept text and output text (chat-capable)
    models = models.filter((m) => {
      const caps = m.capabilities;
      if (!caps) return true; // unknown capabilities → keep
      const out = caps.output_modalities ?? ["text"];
      return out.includes("text");
    });
  }

  return models;
}

// ── Chat completion ──────────────────────────────────────────────────────────

export async function edenChatCompletion(params: {
  apiKey: string;
  region?: EdenRegion;
  model: string; // "provider/model"
  system: string;
  prompt: string;
  maxTokens: number;
  temperature?: number;
  reasoning?: ReasoningEffort;
  signal?: AbortSignal;
}): Promise<EdenChatResult> {
  const { apiKey, region = "eu", model, system, prompt, maxTokens, temperature = 0, reasoning, signal } = params;
  const url = `${edenBaseUrl(region)}/v3/chat/completions`;

  const res = await edenFetch(
    url,
    apiKey,
    {
      method: "POST",
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        max_tokens: maxTokens,
        temperature,
        ...reasoningParams(model, reasoning),
      }),
      signal,
    },
    180_000
  );

  const json = await res.json();
  if (!res.ok) throw edenError(json, res.status);

  const raw: string =
    typeof json?.choices?.[0]?.message?.content === "string"
      ? json.choices[0].message.content.trim()
      : "";

  const usage = json?.usage;
  const promptTokens = Number(usage?.prompt_tokens ?? 0);
  const completionTokens = Number(usage?.completion_tokens ?? 0);
  const tokens = usage
    ? { prompt: promptTokens, completion: completionTokens, total: Number(usage.total_tokens ?? promptTokens + completionTokens) }
    : undefined;

  // Eden reports cost in USD on the LLM endpoint when available
  const costUsd = typeof json?.cost === "number" ? json.cost : undefined;

  return { raw, tokens, costUsd, model: json?.model };
}

// ── Universal AI: web search / scrape (Firecrawl) ───────────────────────────

export interface EdenWebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Firecrawl web search via universal-ai.
 * NOTE: Firecrawl is only available on the US endpoint (api.edenai.run).
 */
export async function edenWebSearch(params: {
  apiKey: string;
  query: string;
  limit?: number;
  depth?: "basic" | "deep";
  provider?: "firecrawl" | "linkup";
  includeDomains?: string[];   // restrict to specific domains (maps-replacement)
  excludeDomains?: string[];
}): Promise<{ results: EdenWebSearchResult[]; costUsd?: number }> {
  const { apiKey, query, limit = 5, depth = "basic", provider = "firecrawl", includeDomains, excludeDomains } = params;
  const url = `${EDEN_BASE_URLS.us}/v3/universal-ai`;
  const model = `web/search/${provider}`;
  const input: Record<string, unknown> = { query, limit };
  if (provider === "firecrawl" && depth === "deep") input.depth = "deep";
  // Add German localization for better results
  if (provider === "firecrawl") {
    input.location = "Germany";
    input.lang = "de";
    input.country = "de";
    if (includeDomains?.length) input.includeDomains = includeDomains;
    if (excludeDomains?.length) input.excludeDomains = excludeDomains;
  }

  const res = await withRetry(() =>
    edenFetch(
      url,
      apiKey,
      {
        method: "POST",
        body: JSON.stringify({ model, input, show_original_response: false }),
      },
      60_000
    )
  );

  const json = await res.json();
  if (!res.ok) throw edenError(json, res.status);
  if (json?.status !== "success") {
    throw new Error(`${provider} search failed: ${json?.error?.message ?? json?.status ?? "unknown"}`);
  }

  const raw: any[] = json?.output?.results ?? [];
  const results = raw
    .map((r) => ({
      title: String(r?.title ?? "").slice(0, 200),
      url: String(r?.url ?? "").trim(),
      snippet: String(r?.content ?? r?.description ?? "").slice(0, 400),
    }))
    .filter((r) => r.url.startsWith("http"));

  return { results, costUsd: typeof json?.cost === "number" ? json.cost : undefined };
}

/**
 * Firecrawl single-URL scrape via universal-ai (US endpoint).
 * Returns markdown content of the page.
 */
export async function edenScrapeUrl(params: {
  apiKey: string;
  url: string;
  signal?: AbortSignal;
}): Promise<{ markdown: string; title?: string; costUsd?: number }> {
  const { apiKey, url, signal } = params;
  const endpoint = `${EDEN_BASE_URLS.us}/v3/universal-ai`;

  const res = await withRetry(() =>
    edenFetch(
      endpoint,
      apiKey,
      {
        method: "POST",
        body: JSON.stringify({
          model: "web/scraping/firecrawl",
          input: { url, formats: ["markdown"] },
          show_original_response: false,
        }),
        signal,
      },
      30_000
    )
  );

  const json = await res.json();
  if (!res.ok) throw edenError(json, res.status);
  if (json?.status !== "success") {
    throw new Error(`Firecrawl scrape failed: ${json?.error?.message ?? json?.status ?? "unknown"}`);
  }

  const data = json?.output?.data ?? json?.output;
  const markdown = String(data?.markdown ?? data?.content ?? "").trim();
  return { markdown, costUsd: typeof json?.cost === "number" ? json.cost : undefined, title: String(data?.title ?? "").trim() };
}

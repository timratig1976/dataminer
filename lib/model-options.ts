/**
 * lib/model-options.ts
 * Model catalog for the UI — Eden AI only ("provider/model" IDs).
 * One API key (EDEN_API_KEY) serves every model through the OpenAI-compatible
 * Eden v3 gateway (/v3/chat/completions). Firecrawl web search/scrape uses the
 * same key via /v3/universal-ai (US endpoint).
 */

export const DEFAULT_MODEL_OPTIONS = [
  // OpenAI (US region only)
  "openai/gpt-4o-mini",
  "openai/gpt-4o",
  // Anthropic
  "anthropic/claude-3-5-haiku-latest",
  "anthropic/claude-sonnet-4-5",
  // Mistral (EU-eligible)
  "mistral/mistral-small-latest",
  "mistral/mistral-large-latest",
  // Google (EU-eligible)
  "google/gemini-flash-latest",
  "google/gemini-pro-latest",
  // Meta / open-weights
  "meta/llama3.3-70b",
  "meta/gpt-oss-120b",
] as const;

/** Canonical default for new columns */
export const DEFAULT_MODEL = "openai/gpt-4o-mini";

export function mergeModelOptions(preferred: string[], fallback: readonly string[] = DEFAULT_MODEL_OPTIONS): string[] {
  return Array.from(new Set([...preferred, ...fallback]));
}

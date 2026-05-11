export const DEFAULT_MODEL_OPTIONS = [
  "gpt-4o-mini",
  "gpt-4o",
  "gpt-4-turbo",
  "llama3.1-8b",
  "llama3.3-70b",
  "qwen-3-32b",
  "gpt-oss-120b",
  "gpt-oss-20b",
  "zai-glm-4.7",
  "glm-5.1",
  "deepseek-v3.2",
  "kimi-k2.6",
  "minimax-m2",
  "mistral-large-3",
  "claude-3-5-haiku-20241022",
  "claude-3-5-sonnet-20241022",
  "claude-3-7-sonnet-20250219",
] as const;

export function mergeModelOptions(preferred: string[], fallback: readonly string[] = DEFAULT_MODEL_OPTIONS): string[] {
  return Array.from(new Set([...preferred, ...fallback]));
}

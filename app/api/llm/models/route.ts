import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getCase, getEffectiveApiKey } from "@/lib/db";
import { inferProviderFromModel } from "@/lib/ai";
import { DEFAULT_MODEL_OPTIONS, mergeModelOptions } from "@/lib/model-options";

type Provider = "openai" | "cerebras" | "anthropic";

const CEREBRAS_CHAT_MODEL_ALLOWLIST = new Set([
  "llama3.1-8b",
  "gpt-oss-120b",
  "zai-glm-4.7",
]);

function normalizeModelIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((m) => (typeof m === "string" ? m.trim() : ""))
    .filter(Boolean);
}

function filterInterestingModels(provider: Provider, models: string[]): string[] {
  const lower = (s: string) => s.toLowerCase();

  return models.filter((id) => {
    const m = lower(id);
    if (provider === "anthropic") return m.startsWith("claude");
    if (provider === "cerebras") {
      return CEREBRAS_CHAT_MODEL_ALLOWLIST.has(m);
    }
    if (
      m.includes("realtime") ||
      m.includes("audio") ||
      m.includes("transcribe") ||
      m.includes("tts") ||
      m.includes("search-preview") ||
      m.includes("instruct")
    ) {
      return false;
    }

    return (
      m.startsWith("gpt-4o") ||
      m.startsWith("gpt-4.1") ||
      m.startsWith("gpt-4-turbo") ||
      m.startsWith("gpt-4") ||
      m.startsWith("o1") ||
      m.startsWith("o3") ||
      m.startsWith("o4")
    );
  });
}

async function fetchOpenAiLikeModels(apiKey: string, provider: "openai" | "cerebras"): Promise<string[]> {
  const client = provider === "cerebras"
    ? new OpenAI({ apiKey, baseURL: "https://api.cerebras.ai/v1", timeout: 30000 })
    : new OpenAI({ apiKey, timeout: 30000 });
  const response = await client.models.list();
  return filterInterestingModels(provider, normalizeModelIds(response.data?.map((m) => m.id)));
}

async function fetchAnthropicModels(apiKey: string): Promise<string[]> {
  const res = await fetch("https://api.anthropic.com/v1/models", {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  });
  const json = await res.json();
  if (!res.ok) {
    const msg = json?.error?.message || json?.error?.type || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return filterInterestingModels("anthropic", normalizeModelIds(json?.data?.map((m: { id?: string }) => m?.id)));
}

export async function GET(req: NextRequest) {
  const caseId = req.nextUrl.searchParams.get("caseId") || undefined;
  let modelAllowlist: string[] = [];

  let openaiKey = process.env.OPENAI_API_KEY;
  let cerebrasKey = process.env.CEREBRAS_API_KEY;
  let anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (caseId) {
    const caseData = getCase(caseId);
    if (!caseData) return NextResponse.json({ error: "Case not found" }, { status: 404 });
    openaiKey = getEffectiveApiKey(caseData, "openai");
    cerebrasKey = getEffectiveApiKey(caseData, "cerebras");
    anthropicKey = getEffectiveApiKey(caseData, "anthropic");
    modelAllowlist = caseData.modelAllowlist ?? [];
  }

  const providerModels: Record<Provider, string[]> = {
    openai: [],
    cerebras: [],
    anthropic: [],
  };

  const providerErrors: Partial<Record<Provider, string>> = {};

  if (openaiKey) {
    try {
      providerModels.openai = await fetchOpenAiLikeModels(openaiKey, "openai");
    } catch (e: unknown) {
      providerErrors.openai = e instanceof Error ? e.message : String(e);
    }
  }

  if (cerebrasKey) {
    try {
      providerModels.cerebras = await fetchOpenAiLikeModels(cerebrasKey, "cerebras");
    } catch (e: unknown) {
      providerErrors.cerebras = e instanceof Error ? e.message : String(e);
    }
  }

  if (anthropicKey) {
    try {
      providerModels.anthropic = await fetchAnthropicModels(anthropicKey);
    } catch (e: unknown) {
      providerErrors.anthropic = e instanceof Error ? e.message : String(e);
    }
  }

  const fallbackByProvider: Record<Provider, string[]> = {
    openai: DEFAULT_MODEL_OPTIONS.filter((m) => inferProviderFromModel(m) === "openai"),
    cerebras: DEFAULT_MODEL_OPTIONS.filter((m) => inferProviderFromModel(m) === "cerebras"),
    anthropic: DEFAULT_MODEL_OPTIONS.filter((m) => inferProviderFromModel(m) === "anthropic"),
  };

  const effectiveProviderModels: Record<Provider, string[]> = {
    openai: openaiKey ? providerModels.openai : fallbackByProvider.openai,
    cerebras: cerebrasKey ? providerModels.cerebras : fallbackByProvider.cerebras,
    anthropic: anthropicKey ? providerModels.anthropic : fallbackByProvider.anthropic,
  };

  const liveModels = Array.from(new Set([
    ...effectiveProviderModels.openai,
    ...effectiveProviderModels.cerebras,
    ...effectiveProviderModels.anthropic,
  ]));

  const hasAnyProviderKey = Boolean(openaiKey || cerebrasKey || anthropicKey);
  const allModels = mergeModelOptions(
    [...liveModels, ...modelAllowlist],
    hasAnyProviderKey ? [] : DEFAULT_MODEL_OPTIONS
  );
  const enabledModels = modelAllowlist.length > 0
    ? allModels.filter((m) => modelAllowlist.includes(m))
    : allModels;

  return NextResponse.json({
    caseId: caseId ?? null,
    models: enabledModels,
    allModels,
    enabledModels,
    liveModels,
    providerModels: effectiveProviderModels,
    providerErrors,
    keysPresent: {
      openai: Boolean(openaiKey),
      cerebras: Boolean(cerebrasKey),
      anthropic: Boolean(anthropicKey),
    },
    providersByModel: Object.fromEntries(allModels.map((m) => [m, inferProviderFromModel(m)])),
  });
}

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { appendLog, getCase, getEffectiveApiKey } from "@/lib/db";
import { inferProviderFromModel } from "@/lib/ai";
import { DEFAULT_MODEL_OPTIONS } from "@/lib/model-options";

const DEFAULT_SMOKE_MODELS = [...DEFAULT_MODEL_OPTIONS] as const;

type LlmProvider = "openai" | "cerebras" | "anthropic";

interface SmokeResult {
  model: string;
  provider: LlmProvider;
  endpoint: string;
  ok: boolean;
  latencyMs: number;
  preview?: string;
  error?: string;
}

function normalizeModels(input: unknown): string[] {
  if (!Array.isArray(input)) return [...DEFAULT_SMOKE_MODELS];
  const models = input
    .filter((m): m is string => typeof m === "string")
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
  return models.length > 0 ? models : [...DEFAULT_SMOKE_MODELS];
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
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

function endpointForModel(provider: LlmProvider, model: string): string {
  if (provider === "anthropic") return "/v1/messages";
  if (provider === "cerebras") return "/v1/chat/completions";
  return isOpenAiResponsesOnlyModel(model) ? "/v1/responses" : "/v1/chat/completions";
}

async function smokeOneModel(model: string, provider: LlmProvider, apiKey?: string): Promise<SmokeResult> {
  const endpoint = endpointForModel(provider, model);
  if (!apiKey) {
    return {
      model,
      provider,
      endpoint,
      ok: false,
      latencyMs: 0,
      error: `Missing ${provider.toUpperCase()} API key`,
    };
  }

  const started = Date.now();
  try {
    let content = "";
    if (provider === "anthropic") {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 12,
          messages: [{ role: "user", content: "Reply with exactly: ok" }],
        }),
      });
      const json = await response.json();
      if (!response.ok) {
        const msg = json?.error?.message || json?.error?.type || `HTTP ${response.status}`;
        throw new Error(msg);
      }
      content = Array.isArray(json?.content)
        ? json.content
            .filter((c: { type?: string }) => c?.type === "text")
            .map((c: { text?: string }) => c?.text ?? "")
            .join("\n")
            .trim()
        : "";
    } else {
      const client = provider === "cerebras"
        ? new OpenAI({ apiKey, baseURL: "https://api.cerebras.ai/v1", timeout: 30000 })
        : new OpenAI({ apiKey, timeout: 30000 });

      const baseRequest = {
        model,
        messages: [
          { role: "system" as const, content: "You are a smoke test responder." },
          { role: "user" as const, content: "Reply with exactly: ok" },
        ],
      };

      if (provider === "openai" && isOpenAiResponsesOnlyModel(model)) {
        const response = await client.responses.create({
          model,
          input: [
            { role: "system", content: "You are a smoke test responder." },
            { role: "user", content: "Reply with exactly: ok" },
          ],
          max_output_tokens: 12,
        });
        content = extractResponsesText(response);
      } else {
        const response = await client.chat.completions.create(
          provider === "openai" && isOpenAiReasoningModel(model)
            ? {
                ...baseRequest,
                max_completion_tokens: 12,
              }
            : {
                ...baseRequest,
                max_tokens: 12,
                temperature: 0,
              }
        );

        content = response.choices[0]?.message?.content?.trim() ?? "";
      }
    }

    return {
      model,
      provider,
      endpoint,
      ok: true,
      latencyMs: Date.now() - started,
      preview: content.slice(0, 120),
    };
  } catch (error: unknown) {
    return {
      model,
      provider,
      endpoint,
      ok: false,
      latencyMs: Date.now() - started,
      error: errorMessage(error),
    };
  }
}

async function runSmokeTest(payload: { caseId?: unknown; models?: unknown }) {
  const caseId = typeof payload.caseId === "string" ? payload.caseId : undefined;
  const models = normalizeModels(payload.models);

  let openaiKey = process.env.OPENAI_API_KEY;
  let cerebrasKey = process.env.CEREBRAS_API_KEY;
  let anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (caseId) {
    const caseData = getCase(caseId);
    if (!caseData) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }
    openaiKey = getEffectiveApiKey(caseData, "openai");
    cerebrasKey = getEffectiveApiKey(caseData, "cerebras");
    anthropicKey = getEffectiveApiKey(caseData, "anthropic");
    appendLog(caseId, `🧪 [SMOKE] Start models=${models.join(", ")}`);
  }

  const results: SmokeResult[] = [];
  for (const model of models) {
    const provider = inferProviderFromModel(model);
    const key = provider === "cerebras"
      ? cerebrasKey
      : provider === "anthropic"
        ? anthropicKey
        : openaiKey;
    const result = await smokeOneModel(model, provider, key);
    results.push(result);
    if (caseId) {
      appendLog(caseId, `${result.ok ? "✅" : "❌"} [SMOKE] model=${result.model} provider=${result.provider} endpoint=${result.endpoint} latency=${result.latencyMs}ms`);
      appendLog(caseId, `   prompt: Reply with exactly: ok`);
      appendLog(caseId, `   ${result.ok ? "output" : "error"}: ${result.ok ? (result.preview || "(empty)") : (result.error || "Unknown error")}`);
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;

  if (caseId) {
    appendLog(caseId, `🏁 [SMOKE] Finished tested=${results.length} passed=${passed} failed=${failed}`);
  }

  return NextResponse.json({
    caseId: caseId ?? null,
    testedModels: models.length,
    passed,
    failed,
    keysPresent: {
      openai: Boolean(openaiKey),
      cerebras: Boolean(cerebrasKey),
      anthropic: Boolean(anthropicKey),
    },
    results,
  });
}

export async function GET() {
  return runSmokeTest({});
}

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    return runSmokeTest(payload ?? {});
  } catch {
    return runSmokeTest({});
  }
}

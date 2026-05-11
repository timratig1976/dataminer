import { NextRequest, NextResponse } from "next/server";
import { appendLog, getCase, getEffectiveApiKey, getRow } from "@/lib/db";
import { inferProviderFromModel, runAiColumn } from "@/lib/ai";
import type { AiColumn } from "@/lib/types";

interface CompareRequestBody {
  caseId?: string;
  rowId?: string;
  column?: AiColumn;
  models?: string[];
}

interface ComparedModelResult {
  model: string;
  provider: "openai" | "cerebras" | "anthropic";
  ok: boolean;
  score: number;
  latencyMs: number;
  value: string;
  validation: "pass" | "fail";
  validationReason: string;
  error?: string;
}

function isOpenAiResponsesOnlyModel(model: string): boolean {
  const m = model.toLowerCase();
  return m.startsWith("o3-pro") || m.includes("deep-research");
}

function endpointForModel(provider: "openai" | "cerebras" | "anthropic", model: string): string {
  if (provider === "anthropic") return "/v1/messages";
  if (provider === "cerebras") return "/v1/chat/completions";
  return isOpenAiResponsesOnlyModel(model) ? "/v1/responses" : "/v1/chat/completions";
}

function scoreValue(value: string, outputMode?: "text" | "json"): number {
  const trimmed = value.trim();
  if (!trimmed) return 5;

  let score = 60;
  if (!/notfound|n\/a|unknown/i.test(trimmed)) score += 20;
  if (trimmed.length >= 3 && trimmed.length <= 280) score += 10;

  if (outputMode === "json") {
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) score += 10;
  }

  return score;
}

function looksLikeDomain(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  return /^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/.test(normalized);
}

function validateValue(column: AiColumn, value: string): { pass: boolean; reason: string; bonus: number } {
  const trimmed = value.trim();
  if (!trimmed) return { pass: false, reason: "empty output", bonus: -40 };
  if (/^notfound$/i.test(trimmed)) return { pass: false, reason: "notFound marker", bonus: -25 };

  if (column.outputMode === "json") {
    const maybeJson = trimmed.startsWith("{") && trimmed.endsWith("}");
    if (!maybeJson && !column.jsonKey) {
      return { pass: false, reason: "json mode expects JSON object", bonus: -20 };
    }
  }

  const keyHint = `${column.outputKey} ${column.jsonKey ?? ""}`.toLowerCase();
  if (keyHint.includes("domain") || keyHint.includes("website") || keyHint.includes("url")) {
    if (!looksLikeDomain(trimmed) && !/^https?:\/\//i.test(trimmed)) {
      return { pass: false, reason: "not a valid domain/url", bonus: -25 };
    }
  }

  return { pass: true, reason: "passes automatic validation", bonus: 20 };
}

function normalizeModels(models: unknown, fallbackModel?: string): string[] {
  const list = Array.isArray(models)
    ? models.filter((m): m is string => typeof m === "string").map((m) => m.trim()).filter(Boolean)
    : [];

  if (list.length > 0) return Array.from(new Set(list)).slice(0, 5);
  if (fallbackModel?.trim()) return [fallbackModel.trim()];
  return ["gpt-4o-mini"];
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as CompareRequestBody;
  const caseId = body.caseId;
  const rowId = body.rowId;
  const column = body.column;

  if (!caseId || !rowId || !column) {
    return NextResponse.json({ error: "caseId, rowId, and column are required" }, { status: 400 });
  }

  const caseData = getCase(caseId);
  if (!caseData) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  const row = getRow(rowId);
  if (!row) return NextResponse.json({ error: "Row not found" }, { status: 404 });

  const models = normalizeModels(body.models, column.model);
  appendLog(caseId, `🧪 [COMPARE] Start row=${row.id} column=${column.name} outputKey=${column.outputKey} models=${models.join(", ")}`);

  const results: ComparedModelResult[] = [];

  for (const model of models) {
    const provider = inferProviderFromModel(model);
    const endpoint = endpointForModel(provider, model);
    const apiKey = getEffectiveApiKey(caseData, provider);
    const started = Date.now();

    appendLog(caseId, `▶ [COMPARE] model=${model} provider=${provider} endpoint=${endpoint}`);

    if (!apiKey) {
      appendLog(caseId, `❌ [COMPARE] model=${model} provider=${provider} endpoint=${endpoint} missing API key`);
      results.push({
        model,
        provider,
        ok: false,
        score: 0,
        latencyMs: 0,
        value: "",
        validation: "fail",
        validationReason: `Missing ${provider.toUpperCase()} API key`,
        error: `Missing ${provider.toUpperCase()} API key`,
      });
      continue;
    }

    const compareColumn: AiColumn = {
      ...column,
      model,
      condition: undefined,
      conditionField: undefined,
    };

    const run = await runAiColumn(compareColumn, row.data, apiKey, provider);
    const latencyMs = Date.now() - started;

    if (run.error) {
      appendLog(caseId, `❌ [COMPARE] model=${model} provider=${provider} endpoint=${endpoint} latency=${latencyMs}ms error=${run.error}`);
      results.push({
        model,
        provider,
        ok: false,
        score: 0,
        latencyMs,
        value: "",
        validation: "fail",
        validationReason: run.error,
        error: run.error,
      });
      continue;
    }

    const value = run.value ?? "";
    const validation = validateValue(column, value);
    const finalScore = Math.max(0, scoreValue(value, column.outputMode) + validation.bonus);
    appendLog(caseId, `${validation.pass ? "✅" : "⚠️"} [COMPARE] model=${model} provider=${provider} endpoint=${endpoint} latency=${latencyMs}ms score=${finalScore} validation=${validation.pass ? "pass" : "fail"} reason=${validation.reason}`);
    appendLog(caseId, `   prompt: ${run.renderedPrompt ?? "(missing)"}`);
    appendLog(caseId, `   raw: ${run.rawResponse ?? "(empty)"}`);
    if (run.tokens) {
      appendLog(caseId, `   tokens: prompt=${run.tokens.prompt} completion=${run.tokens.completion} total=${run.tokens.total}`);
    }
    if (run.costUsd != null) {
      appendLog(caseId, `   costUsd: ${run.costUsd}`);
    }
    appendLog(caseId, `   value: ${value || "(empty)"}`);
    results.push({
      model,
      provider,
      ok: validation.pass,
      score: finalScore,
      latencyMs,
      value,
      validation: validation.pass ? "pass" : "fail",
      validationReason: validation.reason,
    });
  }

  const ranked = [...results].sort((a, b) => b.score - a.score || a.latencyMs - b.latencyMs);
  const bestPassing = ranked.find((r) => r.ok);
  appendLog(caseId, `🏁 [COMPARE] Finished tested=${models.length} recommended=${bestPassing?.model ?? "none"}`);

  return NextResponse.json({
    testedModels: models.length,
    recommendedModel: bestPassing?.model ?? null,
    results: ranked,
  });
}

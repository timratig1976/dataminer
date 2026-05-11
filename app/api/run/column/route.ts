import { NextRequest, NextResponse } from "next/server";
import { getCase, listRows, updateRowCell, getEffectiveApiKey } from "@/lib/db";
import { inferProviderFromModel, runAiColumn } from "@/lib/ai";

const MAX_RATE_RETRY = 3;
const MIN_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10_000;
type RunMode = "all_force" | "empty_only";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(message?: string): boolean {
  if (!message) return false;
  return /\b429\b|rate\s*limit|too many requests/i.test(message);
}

function isEmptyOrNotFound(value: unknown): boolean {
  const text = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  return text === "" || /^notfound$/i.test(text);
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

export async function POST(req: NextRequest) {
  const { caseId, columnId, rowIds, runMode: rawRunMode } = await req.json();
  const runMode: RunMode = rawRunMode === "empty_only" ? "empty_only" : "all_force";

  const caseData = getCase(caseId);
  if (!caseData) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  const column = caseData.aiColumns.find((c) => c.id === columnId);
  if (!column) return NextResponse.json({ error: "Column not found" }, { status: 404 });

  const provider = inferProviderFromModel(column.model);
  const model = column.model || "gpt-4o-mini";
  const endpoint = endpointForModel(provider, model);
  const apiKey = getEffectiveApiKey(caseData, provider) || "";
  if (!apiKey) return NextResponse.json({ error: "No API key configured" }, { status: 400 });

  const allRows = listRows(caseId);
  const selectedRows = rowIds ? allRows.filter((r) => rowIds.includes(r.id)) : allRows;
  const targetRows = runMode === "empty_only"
    ? selectedRows.filter((row) => isEmptyOrNotFound(row.data[column.outputKey]))
    : selectedRows;

  const startedAt = Date.now();

  const results: Record<string, {
    status: string;
    value?: string;
    error?: string;
    multiValues?: Record<string, string>;
    rawResponse?: string;
    renderedPrompt?: string;
    tokens?: { prompt: number; completion: number; total: number };
    costUsd?: number;
    metaData?: Record<string, string>;
  }> = {};

  let adaptiveDelayMs = 0;

  for (const row of targetRows) {
    if (adaptiveDelayMs > 0) {
      const jitter = Math.floor(Math.random() * 120);
      await sleep(adaptiveDelayMs + jitter);
    }

    updateRowCell(row.id, column.outputKey, row.data[column.outputKey] ?? "", "running");

    const effectiveColumn = runMode === "all_force"
      ? { ...column, condition: undefined, conditionField: undefined }
      : column;

    const runId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const runAt = new Date().toISOString();
    let result = await runAiColumn(effectiveColumn, row.data, apiKey, provider);
    let retries = 0;

    while (result.error && isRateLimitError(result.error) && retries < MAX_RATE_RETRY) {
      retries += 1;
      adaptiveDelayMs = Math.min(
        MAX_BACKOFF_MS,
        Math.max(MIN_BACKOFF_MS, adaptiveDelayMs > 0 ? adaptiveDelayMs * 2 : MIN_BACKOFF_MS)
      );
      const jitter = Math.floor(Math.random() * 150);
      await sleep(adaptiveDelayMs + jitter);
      result = await runAiColumn(effectiveColumn, row.data, apiKey, provider);
    }

    if (result.error && isRateLimitError(result.error)) {
      adaptiveDelayMs = Math.min(
        MAX_BACKOFF_MS,
        Math.max(MIN_BACKOFF_MS, adaptiveDelayMs > 0 ? adaptiveDelayMs * 2 : MIN_BACKOFF_MS)
      );
    } else if (!result.error) {
      adaptiveDelayMs = Math.max(0, Math.floor(adaptiveDelayMs * 0.75) - 50);
    }

    const metaData: Record<string, string> = {
      [`_llm_model_${column.outputKey}`]: model,
      [`_llm_provider_${column.outputKey}`]: provider,
      [`_llm_endpoint_${column.outputKey}`]: endpoint,
      [`_llm_run_id_${column.outputKey}`]: runId,
      [`_llm_run_at_${column.outputKey}`]: runAt,
    };
    if (result.rawResponse) metaData[`_llm_raw_${column.outputKey}`] = result.rawResponse;
    if (result.renderedPrompt) metaData[`_llm_prompt_${column.outputKey}`] = result.renderedPrompt;
    if (result.tokens) metaData[`_llm_tokens_${column.outputKey}`] = JSON.stringify(result.tokens);
    if (result.costUsd !== undefined) metaData[`_llm_cost_${column.outputKey}`] = String(result.costUsd);

    if (result.skipped) {
      updateRowCell(row.id, column.outputKey, result.value, "skipped");
      for (const [key, val] of Object.entries(metaData)) {
        updateRowCell(row.id, key, val, "done");
      }
      results[row.id] = { status: "skipped", value: result.value, metaData };
      continue;
    }

    if (result.error) {
      updateRowCell(row.id, column.outputKey, "", "error", result.error);
      for (const [key, val] of Object.entries(metaData)) {
        updateRowCell(row.id, key, val, "done");
      }
      results[row.id] = { status: "error", error: result.error, metaData };
      continue;
    }

    for (const [key, val] of Object.entries(metaData)) {
      updateRowCell(row.id, key, val, "done");
    }
    if (result.multiValues) {
      for (const [key, val] of Object.entries(result.multiValues)) {
        updateRowCell(row.id, key, val, "done");
      }
    } else {
      updateRowCell(row.id, column.outputKey, result.value, "done");
    }
    results[row.id] = {
      status: "done",
      value: result.value,
      multiValues: result.multiValues,
      rawResponse: result.rawResponse,
      renderedPrompt: result.renderedPrompt,
      tokens: result.tokens,
      costUsd: result.costUsd,
      metaData,
    };
  }

  return NextResponse.json({
    runMode,
    selected: selectedRows.length,
    processed: targetRows.length,
    skippedByMode: selectedRows.length - targetRows.length,
    durationMs: Date.now() - startedAt,
    results,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { getCase, getRow, updateRowCell, appendLog, getEffectiveApiKey } from "@/lib/db";
import { inferProviderFromModel, runAiColumn } from "@/lib/ai";

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
  const { caseId, rowId, columnId } = await req.json();

  const caseData = getCase(caseId);
  if (!caseData) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  const row = getRow(rowId);
  if (!row) return NextResponse.json({ error: "Row not found" }, { status: 404 });

  const column = caseData.aiColumns.find((c) => c.id === columnId);
  if (!column) return NextResponse.json({ error: "Column not found" }, { status: 404 });

  const provider = inferProviderFromModel(column.model);
  const model = column.model || "gpt-4o-mini";
  const endpoint = endpointForModel(provider, model);
  const apiKey = getEffectiveApiKey(caseData, provider) || "";
  if (!apiKey) return NextResponse.json({ error: "No API key configured" }, { status: 400 });

  const company = row.data["company_name"] ?? row.data[Object.keys(row.data).find(k => k.toLowerCase().includes("name") || k.toLowerCase().includes("unternehmen")) ?? ""] ?? rowId;
  appendLog(caseId, `▶ [${column.name}] ${company} model=${model} provider=${provider} endpoint=${endpoint}`);
  updateRowCell(rowId, column.outputKey, row.data[column.outputKey] ?? "", "running");

  const runId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const runAt = new Date().toISOString();
  const result = await runAiColumn(column, row.data, apiKey, provider);

  if (result.webSearchQuery) {
    appendLog(caseId, `🔍 [${column.name}] ${company} — web search: "${result.webSearchQuery}" → ${result.webSearchResultCount ?? 0} result(s) via ${result.webSearchSource ?? "?"}`);
  } else if (column.useWebSearch) {
    appendLog(caseId, `⚠ [${column.name}] ${company} — web search enabled but no results (check searchQuery template or SERP_API_KEY)`);
  }

  const metaData: Record<string, string> = {
    [`_llm_model_${column.outputKey}`]: model,
    [`_llm_provider_${column.outputKey}`]: provider,
    [`_llm_endpoint_${column.outputKey}`]: endpoint,
    [`_llm_run_id_${column.outputKey}`]: runId,
    [`_llm_run_at_${column.outputKey}`]: runAt,
  };
  if (result.webSearchQuery) metaData[`_search_query_${column.outputKey}`] = result.webSearchQuery;
  if (result.webSearchResultCount) metaData[`_search_count_${column.outputKey}`] = String(result.webSearchResultCount);
  if (result.webSearchSource) metaData[`_search_source_${column.outputKey}`] = result.webSearchSource;
  if (result.rawResponse) metaData[`_llm_raw_${column.outputKey}`] = result.rawResponse;
  if (result.renderedPrompt) metaData[`_llm_prompt_${column.outputKey}`] = result.renderedPrompt;
  if (result.tokens) metaData[`_llm_tokens_${column.outputKey}`] = JSON.stringify(result.tokens);
  if (result.costUsd !== undefined) metaData[`_llm_cost_${column.outputKey}`] = String(result.costUsd);

  if (result.skipped) {
    updateRowCell(rowId, column.outputKey, result.value, "skipped");
    for (const [key, val] of Object.entries(metaData)) {
      updateRowCell(rowId, key, val, "done");
    }
    appendLog(caseId, `⏭ [${column.name}] ${company} — skipped: ${result.skipReason}`);
    return NextResponse.json({ status: "skipped", value: result.value, reason: result.skipReason, ...metaData });
  }

  if (result.error) {
    updateRowCell(rowId, column.outputKey, "", "error", result.error);
    for (const [key, val] of Object.entries(metaData)) {
      updateRowCell(rowId, key, val, "done");
    }
    appendLog(caseId, `❌ [${column.name}] ${company} — ${result.error}`);
    return NextResponse.json({ status: "error", error: result.error, ...metaData }, { status: 500 });
  }

  for (const [key, val] of Object.entries(metaData)) {
    updateRowCell(rowId, key, val, "done");
  }
  if (result.multiValues) {
    for (const [key, val] of Object.entries(result.multiValues)) {
      updateRowCell(rowId, key, val, "done");
    }
    appendLog(caseId, `✅ [${column.name}] ${company} → ${result.value || "(empty)"}`);
    for (const [key, val] of Object.entries(result.multiValues)) {
      if (val) appendLog(caseId, `   ↳ ${key}: ${val}`);
    }
  } else {
    updateRowCell(rowId, column.outputKey, result.value, "done");
    appendLog(caseId, `✅ [${column.name}] ${company} → ${result.value || "(empty)"}`);
  }
  return NextResponse.json({ status: "done", value: result.value, multiValues: result.multiValues, rawResponse: result.rawResponse, renderedPrompt: result.renderedPrompt, tokens: result.tokens, costUsd: result.costUsd, ...metaData });
}

import { NextRequest, NextResponse } from "next/server";
import { getCase, getRow, updateRowCell, appendLog, resolveEdenKey, resolveEdenRegion } from "@/lib/db";
import { inferProviderFromModel, runAiColumn } from "@/lib/ai";
import { registerOperation, isOperationCancelled, removeOperation, cancelOperation } from "@/lib/operations";

// Eden AI is the sole LLM provider — a single OpenAI-compatible endpoint.
function endpointForModel(_provider: string, _model: string): string {
  return "/v3/chat/completions";
}

export async function POST(req: NextRequest) {
  const { caseId, rowId, columnId } = await req.json();
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 300000); // 5 min timeout
  if (req.signal) {
    req.signal.addEventListener('abort', () => abortController.abort());
  }

  const caseData = await getCase(caseId);
  if (!caseData) {
    clearTimeout(timeout);
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  const row = await getRow(rowId);
  if (!row) {
    clearTimeout(timeout);
    return NextResponse.json({ error: "Row not found" }, { status: 404 });
  }

  const column = caseData.aiColumns.find((c) => c.id === columnId);
  if (!column) {
    clearTimeout(timeout);
    return NextResponse.json({ error: "Column not found" }, { status: 404 });
  }

  const provider = inferProviderFromModel(column.model);
  const model = column.tool === "apollo_contacts" ? "apollo-tool" : (column.model || "openai/gpt-4o-mini");
  const endpoint = column.tool === "apollo_contacts" ? "tool/apollo_contacts" : endpointForModel(provider, model);
  const apiKey = (await resolveEdenKey(caseData)) || "";
  if (!apiKey && !column.tool) {
    clearTimeout(timeout);
    return NextResponse.json({ error: "No API key configured" }, { status: 400 });
  }

  const company = row.data["company_name"] ?? row.data[Object.keys(row.data).find(k => k.toLowerCase().includes("name") || k.toLowerCase().includes("unternehmen")) ?? ""] ?? rowId;
  await appendLog(caseId, `▶ [${column.name}] ${company} model=${model} provider=${provider} endpoint=${endpoint}`);
  await updateRowCell(rowId, column.outputKey, row.data[column.outputKey] ?? "", "running");

  const runId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const runAt = new Date().toISOString();

  // Register operation for server-side cancellation
  const opId = registerOperation({
    type: 'cell',
    caseId,
    rowId,
    columnId,
    startTime: Date.now(),
  });

  let result;
  try {
    // Check cancellation before starting
    if (isOperationCancelled(opId)) {
      await updateRowCell(rowId, column.outputKey, "", "skipped");
      await appendLog(caseId, `⏹ [${column.name}] ${company} — cancelled before start`);
      return NextResponse.json({ status: "cancelled", message: "Operation cancelled", operationId: opId });
    }

    result = await runAiColumn(column, { ...row.data, _case_id: caseId }, apiKey, provider, abortController.signal, opId, await resolveEdenRegion(caseData), undefined, rowId);
  } catch (error: any) {
    clearTimeout(timeout);
    removeOperation(opId);
    if (error.name === 'AbortError' || error.message?.includes('abort') || isOperationCancelled(opId)) {
      await updateRowCell(rowId, column.outputKey, "", "skipped");
      await appendLog(caseId, `⏹ [${column.name}] ${company} — cancelled`);
      return NextResponse.json({ status: "cancelled", message: "Operation cancelled", operationId: opId });
    }
    throw error;
  }
  clearTimeout(timeout);
  removeOperation(opId);

  if (result.webSearchQuery) {
    await appendLog(caseId, `🔍 [${column.name}] ${company} — web search: "${result.webSearchQuery}" → ${result.webSearchResultCount ?? 0} result(s) via ${result.webSearchSource ?? "?"}`);
  } else if (column.useWebSearch) {
    await appendLog(caseId, `⚠ [${column.name}] ${company} — web search enabled but no results (check searchQuery template or SERP_API_KEY)`);
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
  if (result.scrapedUrls?.length) metaData[`_scraped_urls_${column.outputKey}`] = result.scrapedUrls.join(" | ");
  if (result.rawResponse) metaData[`_llm_raw_${column.outputKey}`] = result.rawResponse;
  if (result.renderedPrompt) metaData[`_llm_prompt_${column.outputKey}`] = result.renderedPrompt;
  if (result.tokens) metaData[`_llm_tokens_${column.outputKey}`] = JSON.stringify(result.tokens);
  if (result.costUsd !== undefined) metaData[`_llm_cost_${column.outputKey}`] = String(result.costUsd);

  if (result.skipped) {
    await updateRowCell(rowId, column.outputKey, result.value, "skipped");
    for (const [key, val] of Object.entries(metaData)) {
      await updateRowCell(rowId, key, val, "done");
    }
    await appendLog(caseId, `⏭ [${column.name}] ${company} — skipped: ${result.skipReason}`);
    return NextResponse.json({ status: "skipped", value: result.value, reason: result.skipReason, operationId: opId, ...metaData });
  }

  if (result.error) {
    await updateRowCell(rowId, column.outputKey, "", "error", result.error);
    for (const [key, val] of Object.entries(metaData)) {
      await updateRowCell(rowId, key, val, "done");
    }
    await appendLog(caseId, `❌ [${column.name}] ${company} — ${result.error}`);
    return NextResponse.json({ status: "error", error: result.error, operationId: opId, ...metaData }, { status: 500 });
  }

  for (const [key, val] of Object.entries(metaData)) {
    await updateRowCell(rowId, key, val, "done");
  }
  if (result.multiValues) {
    for (const [key, val] of Object.entries(result.multiValues)) {
      await updateRowCell(rowId, key, val, "done");
    }
    await appendLog(caseId, `✅ [${column.name}] ${company} → ${result.value || "(empty)"}`);
    for (const [key, val] of Object.entries(result.multiValues)) {
      if (val) await appendLog(caseId, `   ↳ ${key}: ${val}`);
    }
  } else {
    await updateRowCell(rowId, column.outputKey, result.value, "done");
    await appendLog(caseId, `✅ [${column.name}] ${company} → ${result.value || "(empty)"}`);
  }
  return NextResponse.json({ status: "done", value: result.value, multiValues: result.multiValues, rawResponse: result.rawResponse, renderedPrompt: result.renderedPrompt, tokens: result.tokens, costUsd: result.costUsd, operationId: opId, ...metaData });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const operationId = searchParams.get('operationId');

  if (!operationId) {
    return NextResponse.json({ error: "operationId required" }, { status: 400 });
  }

  const cancelled = cancelOperation(operationId);
  if (cancelled) {
    return NextResponse.json({ status: "cancelled", operationId });
  } else {
    return NextResponse.json({ error: "Operation not found" }, { status: 404 });
  }
}

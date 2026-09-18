import { NextRequest } from "next/server";
import { getCase, listRows, updateRowCell, resolveEdenKey, resolveEdenRegion, appendLog } from "@/lib/db";
import { inferProviderFromModel, runAiColumn } from "@/lib/ai";
import { registerOperation, isOperationCancelled, removeOperation, cancelOperation } from "@/lib/operations";
import { ApolloBudget } from "@/lib/apollo";

export const runtime = "nodejs";

const MAX_RATE_RETRY = 3;
const MIN_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10_000;
type RunMode = "all_force" | "empty_only";

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function isRateLimitError(m?: string) { return !!m && /\b429\b|rate\s*limit|too many requests/i.test(m); }
function isEmptyOrNotFound(v: unknown, col?: any, rowData?: Record<string, string | null>) {
  if (col && (col.tool === "batch_company" || col.tool === "batch_contact")) {
    if (col.tool === "batch_company" && rowData) {
      const fields: string[] = col.batchOutputFields ?? ["company_name", "domain", "phone", "company_email", "city", "industry"];
      const hasAnyField = fields.some(f => rowData[f] && String(rowData[f]).trim() !== "" && !/^notfound$/i.test(String(rowData[f]).trim()));
      if (hasAnyField) return false;
    }
    if (col.tool === "batch_contact" && rowData) {
      const prefix = col.batchContactsPrefix ?? "contact_";
      const hasContact = !!(rowData[`_contacts_json_${col.outputKey}`] || rowData[`${prefix}1_first_name`] || rowData[`${prefix}1_last_name`]);
      if (hasContact) return false;
    }
  }
  const t = typeof v === "string" ? v.trim() : String(v ?? "").trim();
  return t === "" || /^notfound$/i.test(t);
}

function sseEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * POST /api/run/column/stream
 *
 * Same as POST /api/run/column but returns SSE instead of waiting for all rows.
 * Events:
 *   { type: "start",    columnId, total, operationId }
 *   { type: "row_done", rowId, status, value?, multiValues?, tokens?, costUsd?, error?, metaData? }
 *   { type: "done",     processed, durationMs, operationId }
 *   { type: "error",    message }
 */
export async function POST(req: NextRequest) {
  const { caseId, columnId, rowIds, runMode: rawRunMode, concurrency: rawConcurrency } = await req.json();
  const runMode: RunMode = rawRunMode === "empty_only" ? "empty_only" : "all_force";
  const CONCURRENCY = typeof rawConcurrency === "number" && rawConcurrency >= 1 ? Math.min(rawConcurrency, 20) : 5;

  const stream = new ReadableStream({
    async start(controller) {
      const push = (data: unknown) => {
        try { controller.enqueue(new TextEncoder().encode(sseEvent(data))); } catch { /* closed */ }
      };

      const abortController = new AbortController();
      if (req.signal) {
        req.signal.addEventListener("abort", () => abortController.abort());
      }
      const opId = registerOperation({ type: "column", caseId, columnId, startTime: Date.now() });

      try {
        const caseData = await getCase(caseId);
        if (!caseData) { push({ type: "error", message: "Case not found" }); return; }
        const column = caseData.aiColumns.find((c) => c.id === columnId);
        if (!column) { push({ type: "error", message: "Column not found" }); return; }

        const provider = inferProviderFromModel(column.model);
        const model = column.tool === "apollo_contacts" ? "apollo-tool" : (column.model || "openai/gpt-4o-mini");
        const endpoint = column.tool === "apollo_contacts" ? "tool/apollo_contacts" : "/v3/chat/completions";
        const apiKey = (await resolveEdenKey(caseData)) || "";
        const edenRegion = await resolveEdenRegion(caseData);
        if (!apiKey && !column.tool) { push({ type: "error", message: "No API key configured" }); return; }

        const apolloBudget = column.tool === "apollo_contacts" ? new ApolloBudget() : undefined;
        const allRows = await listRows(caseId);
        const selectedRows = rowIds ? allRows.filter((r) => rowIds.includes(r.id)) : allRows;
        const targetRows = runMode === "empty_only"
          ? selectedRows.filter((row) => isEmptyOrNotFound(row.data[column.outputKey], column, row.data))
          : selectedRows;

        push({ type: "start", columnId, columnName: column.name, total: targetRows.length, operationId: opId });

        const startedAt = Date.now();
        let adaptiveDelayMs = 0;
        let processed = 0;
        const col = column;

        async function processRow(row: typeof targetRows[number]) {
          if (adaptiveDelayMs > 0) await sleep(adaptiveDelayMs + Math.floor(Math.random() * 200));
          await updateRowCell(row.id, col.outputKey, row.data[col.outputKey] ?? "", "running");

          const effectiveColumn = runMode === "all_force" ? { ...col, condition: undefined, conditionField: undefined } : col;
          const runId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
          const runAt = new Date().toISOString();

          let result;
          try {
            result = await runAiColumn(effectiveColumn, { ...row.data, _case_id: caseId }, apiKey, provider, abortController.signal, opId, edenRegion, apolloBudget, row.id);
          } catch (err: unknown) {
            const msg = (err as Error).message ?? "";
            if ((err as Error).name === "AbortError" || msg.includes("abort") || isOperationCancelled(opId)) {
              await updateRowCell(row.id, col.outputKey, "", "skipped");
              push({ type: "row_done", rowId: row.id, status: "cancelled" });
              return;
            }
            throw err;
          }

          let retries = 0;
          while (result.error && isRateLimitError(result.error) && retries < MAX_RATE_RETRY) {
            retries++;
            adaptiveDelayMs = Math.min(MAX_BACKOFF_MS, Math.max(MIN_BACKOFF_MS, adaptiveDelayMs > 0 ? adaptiveDelayMs * 2 : MIN_BACKOFF_MS));
            await sleep(adaptiveDelayMs + Math.floor(Math.random() * 200));
            try {
              result = await runAiColumn(effectiveColumn, { ...row.data, _case_id: caseId }, apiKey, provider, abortController.signal, opId, edenRegion, apolloBudget, row.id);
            } catch (err: unknown) {
              const msg = (err as Error).message ?? "";
              if ((err as Error).name === "AbortError" || msg.includes("abort") || isOperationCancelled(opId)) {
                await updateRowCell(row.id, col.outputKey, "", "skipped");
                push({ type: "row_done", rowId: row.id, status: "cancelled" });
                return;
              }
              throw err;
            }
          }

          if (result.error && isRateLimitError(result.error)) {
            adaptiveDelayMs = Math.min(MAX_BACKOFF_MS, Math.max(MIN_BACKOFF_MS, adaptiveDelayMs > 0 ? adaptiveDelayMs * 2 : MIN_BACKOFF_MS));
          } else if (!result.error) {
            adaptiveDelayMs = Math.max(0, Math.floor(adaptiveDelayMs * 0.75) - 50);
          }

          const metaData: Record<string, string> = {
            [`_llm_model_${col.outputKey}`]: model,
            [`_llm_provider_${col.outputKey}`]: provider,
            [`_llm_endpoint_${col.outputKey}`]: endpoint,
            [`_llm_run_id_${col.outputKey}`]: runId,
            [`_llm_run_at_${col.outputKey}`]: runAt,
          };
          if (result.webSearchQuery) metaData[`_search_query_${col.outputKey}`] = result.webSearchQuery;
          if (result.webSearchResultCount) metaData[`_search_count_${col.outputKey}`] = String(result.webSearchResultCount);
          if (result.webSearchSource) metaData[`_search_source_${col.outputKey}`] = result.webSearchSource;
          if (result.scrapedUrls?.length) metaData[`_scraped_urls_${col.outputKey}`] = result.scrapedUrls.join(" | ");
          if (result.rawResponse) metaData[`_llm_raw_${col.outputKey}`] = result.rawResponse;
          if (result.renderedPrompt) metaData[`_llm_prompt_${col.outputKey}`] = result.renderedPrompt;
          if (result.tokens) metaData[`_llm_tokens_${col.outputKey}`] = JSON.stringify(result.tokens);
          if (result.costUsd !== undefined) metaData[`_llm_cost_${col.outputKey}`] = String(result.costUsd);

          const company = row.data["company_name"] ?? row.data[Object.keys(row.data).find((k) => k.toLowerCase().includes("name")) ?? ""] ?? row.id.slice(0, 8);

          if (result.skipped) {
            await updateRowCell(row.id, col.outputKey, result.value, "skipped");
            for (const [k, v] of Object.entries(metaData)) await updateRowCell(row.id, k, v, "done");
            await appendLog(caseId, `⏭ [${col.name}] ${company} — skipped: ${result.skipReason ?? "condition not met"}`);
            push({ type: "row_done", rowId: row.id, status: "skipped", value: result.value, metaData });
            processed++;
            return;
          }

          if (result.error) {
            const isAborted = result.error.includes("abort") || result.error.includes("AbortError") || isOperationCancelled(opId);
            const finalStatus = isAborted ? "skipped" : "error";
            const finalErr = isAborted ? "" : result.error;
            await updateRowCell(row.id, col.outputKey, "", finalStatus, finalErr);
            for (const [k, v] of Object.entries(metaData)) await updateRowCell(row.id, k, v, "done");
            if (!isAborted) {
              await appendLog(caseId, `❌ [${col.name}] ${company} — error: ${result.error}`);
            }
            push({ type: "row_done", rowId: row.id, status: finalStatus, error: finalErr, metaData });
            processed++;
            return;
          }

          for (const [k, v] of Object.entries(metaData)) await updateRowCell(row.id, k, v, "done");
          if (result.multiValues) {
            for (const [k, v] of Object.entries(result.multiValues)) await updateRowCell(row.id, k, v, "done");
          }
          await updateRowCell(row.id, col.outputKey, result.value, "done");

          const tokensInfo = result.tokens ? ` · ${result.tokens.total}tok` : "";
          const costInfo = result.costUsd ? ` · $${result.costUsd.toFixed(5)}` : "";
          const preview = typeof result.value === "string" ? result.value.slice(0, 80).replace(/\n/g, " ") : "";
          await appendLog(caseId, `✓ [${col.name}] ${company}${tokensInfo}${costInfo} → ${preview}`);

          // 🔑 Push event immediately — client updates the row in real-time
          push({
            type: "row_done",
            rowId: row.id,
            status: "done",
            value: result.value,
            multiValues: result.multiValues,
            tokens: result.tokens,
            costUsd: result.costUsd,
            metaData,
          });
          processed++;
        }

        // Run in CONCURRENCY batches
        for (let i = 0; i < targetRows.length; i += CONCURRENCY) {
          if (isOperationCancelled(opId)) break;
          const batch = targetRows.slice(i, i + CONCURRENCY);
          await Promise.all(batch.map(processRow));
        }

        push({ type: "done", processed, durationMs: Date.now() - startedAt, operationId: opId });
      } catch (err: unknown) {
        const msg = (err as Error).message ?? "Unknown error";
        push({ type: "error", message: msg });
      } finally {
        removeOperation(opId);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const operationId = searchParams.get("operationId");
  if (!operationId) return Response.json({ error: "operationId required" }, { status: 400 });
  const cancelled = cancelOperation(operationId);
  return Response.json(cancelled ? { status: "cancelled", operationId } : { error: "Not found" }, { status: cancelled ? 200 : 404 });
}

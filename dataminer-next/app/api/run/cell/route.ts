import { NextRequest, NextResponse } from "next/server";
import { getCase, getRow, updateRowCell, appendLog } from "@/lib/db";
import { runAiColumn } from "@/lib/ai";

export async function POST(req: NextRequest) {
  const { caseId, rowId, columnId } = await req.json();

  const caseData = getCase(caseId);
  if (!caseData) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  const row = getRow(rowId);
  if (!row) return NextResponse.json({ error: "Row not found" }, { status: 404 });

  const column = caseData.aiColumns.find((c) => c.id === columnId);
  if (!column) return NextResponse.json({ error: "Column not found" }, { status: 404 });

  const apiKey = caseData.apiKey || process.env.OPENAI_API_KEY || "";
  if (!apiKey) return NextResponse.json({ error: "No API key configured" }, { status: 400 });

  const company = row.data["company_name"] ?? rowId;
  appendLog(caseId, `▶ [${column.name}] ${company}`);
  updateRowCell(rowId, column.outputKey, row.data[column.outputKey] ?? "", "running");

  const result = await runAiColumn(column, row.data, apiKey);

  if (result.skipped) {
    updateRowCell(rowId, column.outputKey, result.value, "skipped");
    appendLog(caseId, `⏭ [${column.name}] ${company} — skipped: ${result.skipReason}`);
    return NextResponse.json({ status: "skipped", value: result.value, reason: result.skipReason });
  }

  if (result.error) {
    updateRowCell(rowId, column.outputKey, "", "error", result.error);
    appendLog(caseId, `❌ [${column.name}] ${company} — ${result.error}`);
    return NextResponse.json({ status: "error", error: result.error }, { status: 500 });
  }

  if (result.rawResponse) {
    updateRowCell(rowId, `_llm_raw_${column.outputKey}`, result.rawResponse, "done");
  }
  if (result.renderedPrompt) {
    updateRowCell(rowId, `_llm_prompt_${column.outputKey}`, result.renderedPrompt, "done");
  }
  if (result.tokens) {
    updateRowCell(rowId, `_llm_tokens_${column.outputKey}`, JSON.stringify(result.tokens), "done");
  }
  if (result.costUsd !== undefined) {
    updateRowCell(rowId, `_llm_cost_${column.outputKey}`, String(result.costUsd), "done");
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
  return NextResponse.json({ status: "done", value: result.value, multiValues: result.multiValues, rawResponse: result.rawResponse, renderedPrompt: result.renderedPrompt, tokens: result.tokens, costUsd: result.costUsd });
}

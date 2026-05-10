import { NextRequest, NextResponse } from "next/server";
import { getCase, listRows, updateRowCell } from "@/lib/db";
import { runAiColumn } from "@/lib/ai";

export async function POST(req: NextRequest) {
  const { caseId, columnId, rowIds } = await req.json();

  const caseData = getCase(caseId);
  if (!caseData) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  const column = caseData.aiColumns.find((c) => c.id === columnId);
  if (!column) return NextResponse.json({ error: "Column not found" }, { status: 404 });

  const apiKey = caseData.apiKey || process.env.OPENAI_API_KEY || "";
  if (!apiKey) return NextResponse.json({ error: "No API key configured" }, { status: 400 });

  const allRows = listRows(caseId);
  const targetRows = rowIds ? allRows.filter((r) => rowIds.includes(r.id)) : allRows;

  const results: Record<string, { status: string; value?: string; error?: string; multiValues?: Record<string,string>; rawResponse?: string }> = {};

  await Promise.all(
    targetRows.map(async (row) => {
      updateRowCell(row.id, column.outputKey, row.data[column.outputKey] ?? "", "running");
      const result = await runAiColumn(column, row.data, apiKey);
      if (result.skipped) {
        updateRowCell(row.id, column.outputKey, result.value, "skipped");
        results[row.id] = { status: "skipped", value: result.value };
      } else if (result.error) {
        updateRowCell(row.id, column.outputKey, "", "error", result.error);
        results[row.id] = { status: "error", error: result.error };
      } else {
        if (result.rawResponse) {
          updateRowCell(row.id, `_llm_raw_${column.outputKey}`, result.rawResponse, "done");
        }
        if (result.multiValues) {
          for (const [key, val] of Object.entries(result.multiValues)) {
            updateRowCell(row.id, key, val, "done");
          }
        } else {
          updateRowCell(row.id, column.outputKey, result.value, "done");
        }
        results[row.id] = { status: "done", value: result.value, multiValues: result.multiValues, rawResponse: result.rawResponse };
      }
    })
  );

  return NextResponse.json({ results });
}
